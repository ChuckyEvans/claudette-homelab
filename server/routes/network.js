import { Router } from 'express'
import { spawn, exec, execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { createSocket } from 'dgram'
import { promises as dnsPromises } from 'dns'
import { loadConfig } from '../config.js'
import { isPrivateIP, isPrivateCIDR, ipInCIDR, getCIDRHosts } from '../utils/ip.js'
import { audit, auditDevice, upsertDevice, markOffline, getAllDevices, getAllFlags, createFlag, updateFlag, deleteFlag, clearAllDevices, clearPhantomDevices, clearDevicePorts, setDeviceLabel, toggleDeviceFlag, toggleFavorite, toggleFlagged, toggleDormant, autoDormantStale } from '../db.js'

const router = Router()

function getNmapBin() {
  const candidates = [
    'C:\\Program Files (x86)\\Nmap\\nmap.exe',
    'C:\\Program Files\\Nmap\\nmap.exe',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return 'nmap' // rely on PATH (Linux/Mac/Pi)
}

let _scanResults = []
let _lastScan = null
let _scanning = false
let _broadcastRef = null
let _scanProcs = []
let _portScanProcs = new Map()   // ip → nmap proc for per-device scans
let _gateway = null

// ── OUI / MAC vendor lookup ──────────────────────────────────────────────────────────
const _ouiMap = new Map()

;(function loadOui() {
  // nmap bundles an OUI file on Alpine/Debian; format: "XXXXXX Vendor Name"
  const candidates = [
    '/usr/share/nmap/nmap-mac-prefixes',
    '/usr/share/ieee-data/oui.txt',
    '/usr/share/arp-scan/ieee-oui.txt',
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^([0-9A-Fa-f]{6})\s+(.+)/)
        if (m) _ouiMap.set(m[1].toUpperCase(), m[2].trim())
      }
      console.log(`[oui] Loaded ${_ouiMap.size} prefixes from ${p}`)
      return
    } catch { /* skip */ }
  }
  console.log('[oui] No OUI database found — vendor names will rely on nmap results only')
})()

export function lookupOuiVendor(mac) {
  if (!mac) return null
  const prefix = mac.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase()
  return _ouiMap.get(prefix) ?? null
}

// ── Passive ARP gateway detection ─────────────────────────────────────────────
// Captures "who-has GW tell DEVICE" ARP broadcasts to discover each device's
// configured default gateway without any active probing.
let _deviceGatewayMap = {}  // { deviceIp: { [targetIp]: count } }
let _arpSnifferProc = null

export function startBackgroundArpSniffer() {
  if (_arpSnifferProc) return
  if (process.platform === 'win32') return  // tcpdump not available on Windows
  try {
    _arpSnifferProc = spawn('tcpdump', ['-i', 'any', '-n', '-l', 'arp'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let buf = ''
    _arpSnifferProc.stdout.on('data', d => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        // "ARP, Request who-has 192.168.8.3 tell 192.168.8.105"
        const m = line.match(/who-has (\d+\.\d+\.\d+\.\d+) tell (\d+\.\d+\.\d+\.\d+)/)
        if (!m) continue
        const [, targetIp, deviceIp] = m
        if (!_deviceGatewayMap[deviceIp]) _deviceGatewayMap[deviceIp] = {}
        _deviceGatewayMap[deviceIp][targetIp] = (_deviceGatewayMap[deviceIp][targetIp] ?? 0) + 1
      }
    })
    _arpSnifferProc.on('error', () => { _arpSnifferProc = null })
    _arpSnifferProc.on('close', () => { _arpSnifferProc = null })
  } catch {
    _arpSnifferProc = null
  }
}

/** Returns the most-ARPed gateway IP for a device, preferring known gateway IPs. */
function getDetectedGateway(deviceIp, knownGwIps) {
  const targets = _deviceGatewayMap[deviceIp]
  if (!targets) return null
  const sorted = Object.entries(targets).sort((a, b) => b[1] - a[1])
  // Prefer the most-frequent target that is a known gateway
  const gwMatch = sorted.find(([ip]) => knownGwIps.includes(ip))
  return (gwMatch ?? sorted[0])?.[0] ?? null
}

/** Read default gateway IPs from the OS routing table (Linux: `ip route show default`). */
function getDefaultGateway() {
  if (process.platform === 'win32') return null
  try {
    const out = execSync('ip route show default', { timeout: 3000 }).toString()
    const matches = [...out.matchAll(/via (\d+\.\d+\.\d+\.\d+)/g)]
    const gws = [...new Set(matches.map(m => m[1]))]
    return gws.length ? gws : null
  } catch {
    return null
  }
}

// ── Passive mDNS sniffer ──────────────────────────────────────────────────────
// Listens on the mDNS multicast group (224.0.0.251:5353) for device
// announcements. Extracts A records (hostname.local → IPv4) so devices on
// subnets whose DHCP server doesn't publish PTR records (e.g. TP-Link Deco
// on 192.168.68.x) can still have hostnames resolved passively over time.
const _mdnsMap = {}   // { ip: hostname }
let _mdnsSocket = null

function _parseDnsName(buf, pos) {
  const labels = []
  let end = -1
  let jumped = false
  while (pos < buf.length) {
    const b = buf[pos]
    if ((b & 0xc0) === 0xc0) {
      if (!jumped) end = pos + 2
      pos = ((b & 0x3f) << 8) | buf[pos + 1]
      jumped = true
    } else if (b === 0) {
      if (!jumped) end = pos + 1
      break
    } else {
      if (pos + 1 + b > buf.length) break
      labels.push(buf.slice(pos + 1, pos + 1 + b).toString('utf8'))
      pos += 1 + b
    }
  }
  return { name: labels.join('.'), end: end >= 0 ? end : pos + 1 }
}

function _parseMdnsPacket(buf) {
  if (buf.length < 12) return []
  const qdCount = buf.readUInt16BE(4)
  const anCount = buf.readUInt16BE(6)
  const nsCount = buf.readUInt16BE(8)
  const arCount = buf.readUInt16BE(10)
  let offset = 12
  const records = []
  // Skip question section
  for (let i = 0; i < qdCount && offset < buf.length; i++) {
    const { end } = _parseDnsName(buf, offset)
    offset = end + 4
  }
  // Parse answer + authority + additional sections
  for (let i = 0; i < anCount + nsCount + arCount && offset < buf.length; i++) {
    const { name, end } = _parseDnsName(buf, offset)
    offset = end
    if (offset + 10 > buf.length) break
    const type = buf.readUInt16BE(offset)
    const rdlen = buf.readUInt16BE(offset + 8)
    offset += 10
    if (offset + rdlen > buf.length) break
    if (type === 1 /* A */ && rdlen === 4) {
      const ip = `${buf[offset]}.${buf[offset+1]}.${buf[offset+2]}.${buf[offset+3]}`
      records.push({ type: 'A', name: name.replace(/\.$/, ''), ip })
    }
    offset += rdlen
  }
  return records
}

export function startMdnsSniffer() {
  if (_mdnsSocket) return
  try {
    _mdnsSocket = createSocket({ type: 'udp4', reuseAddr: true })
    _mdnsSocket.on('message', (msg) => {
      try {
        for (const r of _parseMdnsPacket(msg)) {
          if (r.type === 'A' && r.ip && r.name && !_mdnsMap[r.ip]) {
            _mdnsMap[r.ip] = r.name
            console.log(`[mdns] ${r.ip} → ${r.name}`)
          }
        }
      } catch { /* ignore malformed packets */ }
    })
    _mdnsSocket.on('error', (err) => { console.log('[mdns] error:', err.message); _mdnsSocket = null })
    _mdnsSocket.bind(5353, () => {
      try { _mdnsSocket.addMembership('224.0.0.251') } catch { /* may fail if multicast unsupported */ }
      console.log('[mdns] Passive sniffer started on 224.0.0.251:5353')
      // Send a DNS-SD probe to elicit announcements from all local mDNS devices
      _sendMdnsProbe()
    })
  } catch (err) {
    console.log('[mdns] Could not start sniffer:', err.message)
    _mdnsSocket = null
  }
}

function _buildDnsQuery(name, qtype) {
  const labels = name.split('.')
  const parts = labels.map(l => { const b = Buffer.from(l, 'ascii'); return Buffer.concat([Buffer.from([b.length]), b]) })
  parts.push(Buffer.from([0]))
  const qname = Buffer.concat(parts)
  const hdr = Buffer.alloc(12); hdr.writeUInt16BE(1, 4)  // QDCOUNT=1
  return Buffer.concat([hdr, qname, Buffer.from([0x00, qtype, 0x00, 0x01])])
}

function _sendMdnsProbe() {
  if (!_mdnsSocket) return
  try {
    // Query _services._dns-sd._udp.local PTR — causes all mDNS devices to re-announce
    const pkt = _buildDnsQuery('_services._dns-sd._udp.local', 0x0c)
    _mdnsSocket.send(pkt, 5353, '224.0.0.251')
  } catch { /* ignore */ }
}

// Send unicast mDNS DNS-SD queries directly to each IP:5353 and collect A records.
// Complements the multicast sniffer for devices that only respond to unicast.
function mdnsUnicastBurst(ips) {
  if (!ips.length) return Promise.resolve()
  return new Promise(resolve => {
    let sock
    const done = () => { try { sock?.close() } catch {} resolve() }
    const timer = setTimeout(done, 1500)
    try {
      sock = createSocket('udp4')
      sock.on('message', (msg) => {
        try {
          for (const r of _parseMdnsPacket(msg)) {
            if (r.type === 'A' && r.ip && r.name && !_mdnsMap[r.ip]) {
              _mdnsMap[r.ip] = r.name
              console.log(`[mdns-unicast] ${r.ip} → ${r.name}`)
            }
          }
        } catch { /* ignore malformed packets */ }
      })
      sock.on('error', () => { clearTimeout(timer); resolve() })
      sock.bind(0, () => {
        const query = _buildDnsQuery('_services._dns-sd._udp.local', 0x0c)
        for (const ip of ips) {
          try { sock.send(query, 5353, ip) } catch { /* skip unreachable */ }
        }
      })
    } catch { clearTimeout(timer); resolve() }
  })
}

function getSubnets() {
  const cfg = loadConfig()
  // subnets array takes priority; fall back to old single-string subnet for backward compat
  const raw = cfg?.network?.subnets ?? (cfg?.network?.subnet ? [cfg.network.subnet] : null)
  if (raw?.length) return raw.filter(s => isPrivateCIDR(s))
  // Auto-derive from server host — exclude Docker bridge range (172.16-31.x.x)
  const host = cfg?.pi?.host ?? '192.168.1.10'
  const parts = host.split('.')
  if (parts.length === 4) {
    const second = parseInt(parts[1])
    // Don't derive a subnet from a Docker/virtual address
    if (parseInt(parts[0]) === 172 && second >= 16 && second <= 31) return ['192.168.1.0/24']
    return [`${parts[0]}.${parts[1]}.${parts[2]}.0/24`]
  }
  return ['192.168.1.0/24']
}

// onProgress(percent: number) — optional; used only by per-device port scans (--stats-every)
// onProcess(proc) — optional; called immediately with the spawned process
function runNmap(args, onProgress, onProcess) {
  const bin = getNmapBin()
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    _scanProcs.push(proc)
    if (onProcess) onProcess(proc)
    let stdout = ''
    let stderrBuf = ''

    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => {
      if (!onProgress) return
      stderrBuf += d
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop()
      for (const line of lines) {
        const m = line.match(/About\s+([\d.]+)%\s+done/)
        if (m) onProgress(parseFloat(m[1]))
      }
    })
    proc.on('close', code => {
      _scanProcs = _scanProcs.filter(p => p !== proc)
      if (code === 0 || stdout.length > 0) resolve(stdout)
      else reject(new Error(stderrBuf.trim() || `nmap exited with code ${code}`))
    })
    proc.on('error', err => {
      _scanProcs = _scanProcs.filter(p => p !== proc)
      if (err.code === 'ENOENT') reject(new Error('nmap is not installed on this server'))
      else reject(err)
    })
  })
}

function parseNmapOutput(output) {
  const devices = []
  let cur = null
  let curPort = null
  let section = null  // 'traceroute' | 'host-scripts' | null

  for (const raw of output.split('\n')) {
    const l = raw.trim()

    // ── New host ──────────────────────────────────────────────────────────────
    const hostMatch = l.match(/^Nmap scan report for (.+)/)
    if (hostMatch) {
      if (cur) devices.push(cur)
      const token = hostMatch[1].trim()
      const ipMatch = token.match(/\(([^)]+)\)$/)
      const ip = ipMatch ? ipMatch[1] : token
      const hostname = ipMatch ? token.replace(/\s*\([^)]+\)$/, '').trim() : null
      cur = { ip, hostname, status: 'unknown', mac: null, vendor: null, ports: [], latency: null, os: null, hostScripts: [], traceroute: [] }
      curPort = null; section = null
      continue
    }
    if (!cur) continue

    // ── Host status ───────────────────────────────────────────────────────────
    const upMatch = l.match(/^Host is (up|down)/)
    if (upMatch) {
      cur.status = upMatch[1]
      const latMatch = l.match(/\(([0-9.]+)s latency\)/)
      if (latMatch) cur.latency = Math.round(parseFloat(latMatch[1]) * 1000)
      continue
    }

    // ── MAC ───────────────────────────────────────────────────────────────────
    const macMatch = l.match(/^MAC Address: ([A-Fa-f0-9:]{17})\s*\(([^)]*)\)/)
    if (macMatch) { cur.mac = macMatch[1]; cur.vendor = macMatch[2] || 'Unknown'; continue }

    // ── OS ────────────────────────────────────────────────────────────────────
    const osDetails = l.match(/^OS details:\s*(.+)/)
    if (osDetails) { cur.os = osDetails[1]; continue }
    if (!cur.os) {
      const osRunning = l.match(/^Running(?:\s+\(JUST GUESSING\))?:\s*(.+)/)
      if (osRunning) { cur.os = osRunning[1]; continue }
    }

    // ── Special sections ──────────────────────────────────────────────────────
    if (l.startsWith('TRACEROUTE'))     { section = 'traceroute';    curPort = null; continue }
    if (l === 'Host script results:')   { section = 'host-scripts';  curPort = null; continue }

    // ── Traceroute hops ───────────────────────────────────────────────────────
    if (section === 'traceroute') {
      if (l === '') { section = null; continue }
      const hopMatch = l.match(/^(\d+)\s+([\d.]+)\s+ms\s+(.+)/)
      if (hopMatch) cur.traceroute.push({ hop: parseInt(hopMatch[1]), rtt: parseFloat(hopMatch[2]), address: hopMatch[3].trim() })
      continue
    }

    // ── Port ──────────────────────────────────────────────────────────────────
    const portMatch = l.match(/^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)?\s*(.*)/)
    if (portMatch) {
      curPort = {
        port: parseInt(portMatch[1]), protocol: portMatch[2], state: portMatch[3],
        service: portMatch[4] || '', version: portMatch[5]?.trim() || '',
        scripts: [],
      }
      cur.ports.push(curPort)
      section = null
      continue
    }

    // ── Script output lines ───────────────────────────────────────────────────
    if (l.startsWith('|')) {
      const scriptLine = l.replace(/^\|_?\s*/, '').trim()
      if (!scriptLine) continue
      if (section === 'host-scripts') cur.hostScripts.push(scriptLine)
      else if (curPort) curPort.scripts.push(scriptLine)
      continue
    }
  }

  if (cur) devices.push(cur)
  return devices.filter(d => d.ip && d.ip !== '0.0.0.0')
}

// ── DHCP leases file ─────────────────────────────────────────────────────────
// On Pi deployments the leases file is mounted at /data/dhcp.leases.
// Format (dnsmasq): <timestamp> <mac> <ip> <hostname> <client-id>
function readDhcpLeases() {
  const LEASES_PATH = '/data/dhcp.leases'
  if (!existsSync(LEASES_PATH)) return {}
  const map = {}
  try {
    for (const line of readFileSync(LEASES_PATH, 'utf8').trim().split('\n')) {
      const p = line.trim().split(/\s+/)
      if (p.length >= 4 && p[3] && p[3] !== '*') map[p[2]] = p[3]
    }
  } catch { /* ignore */ }
  return map
}

// ── DNS PTR reverse lookup ────────────────────────────────────────────────────
// Uses the system DNS resolver (cross-platform: Windows & Linux).
// On most home networks the router's DHCP server publishes PTR records,
// so this resolves names that mDNS/NetBIOS may miss (e.g. Android, smart TVs).
async function dnsReverseLookup(ips) {
  const results = {}
  await Promise.all(ips.map(async ip => {
    try {
      const names = await Promise.race([
        dnsPromises.reverse(ip),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
      ])
      if (names.length) {
        // Strip trailing .local / .home / .lan suffixes for display
        results[ip] = names[0].replace(/\.(local|home|lan|internal)\.?$/i, '')
      }
    } catch { /* NXDOMAIN, timeout, or network error — skip */ }
  }))
  return results
}

// ── NetBIOS name resolution ───────────────────────────────────────────────────
// Queries UDP port 137 via nmap's nbstat script — works cross-subnet (unicast).
// Returns { [ip]: netbiosName } for devices that respond.
async function nbstatLookup(ips) {
  if (!ips.length) return {}
  try {
    const output = await runNmap([
      '-sU', '-p', '137',
      '--script', 'nbstat.nse',
      '--host-timeout', '5s',
      '--max-retries', '1',
      ...ips,
    ])
    const results = {}
    for (const d of parseNmapOutput(output)) {
      for (const line of (d.hostScripts ?? [])) {
        const m = line.match(/NetBIOS name:\s*([^,<\s]+)/)
        if (m && m[1] !== 'unknown') { results[d.ip] = m[1]; break }
      }
    }
    return results
  } catch { return {} }
}

export async function performScan(broadcast) {
  if (_scanning) return _scanResults
  _scanning = true

  // Start passive ARP sniffer (no-op if already running)
  startBackgroundArpSniffer()

  try {
    const subnets = getSubnets()
    const invalidSubnet = subnets.find(s => !isPrivateCIDR(s))
    if (invalidSubnet) {
      const msg = `Scan blocked: '${invalidSubnet}' is not a private LAN range. Check your config subnets (Settings) — it may be set to a VPN address.`
      if (broadcast) broadcast('scan_error', { error: msg })
      audit('scan.blocked', { subnet: invalidSubnet, reason: 'non-private CIDR' })
      throw new Error(msg)
    }
    const _scanStartMs = Date.now()
    if (broadcast) broadcast('scan_started', { ts: _scanStartMs, subnets })
    audit('scan.started', { subnets })

    // Ping-sweep with multiple probe types — detects devices that block ICMP:
    // -PE: ICMP echo (standard ping)
    // -PS: TCP SYN to common ports (phones, TVs, IoT with open ports)
    // -PP: ICMP timestamp (some devices respond to this but not echo)
    // -PR: ARP scan (local subnet, most reliable — cannot be blocked at L2)
    const NMAP_SWEEP_ARGS = [
      '-sn',
      '-PE', '-PP',
      '-PS22,80,443,8080,3000,8123,9091,5000,1883',
      '--host-timeout', '5s',
      '--max-retries', '2',
      '--min-rate', '300',
    ]

    // Collect batches from all subnets — /24s are split into batches of 32 IPs;
    // larger / non-standard CIDRs are passed as a single item.
    const BATCH_SIZE = 32
    const allBatches = []
    for (const subnet of subnets) {
      const hosts = getCIDRHosts(subnet)
      if (hosts) {
        for (let i = 0; i < hosts.length; i += BATCH_SIZE) allBatches.push(hosts.slice(i, i + BATCH_SIZE))
      } else {
        allBatches.push([subnet])  // large/non-standard CIDR — pass directly
      }
    }

    // Run batches with limited concurrency to avoid flooding cross-subnet
    // mesh routers (e.g. TP-Link Deco) which may drop packets under high load.
    const SCAN_CONCURRENCY = 4
    let completedBatches = 0
    let onlineCount = 0

    async function runBatch(batch) {
      const isCidr = batch.length === 1 && batch[0].includes('/')
      const output = isCidr
        ? await runNmap([...NMAP_SWEEP_ARGS, '--stats-every', '2s', batch[0]])
        : await runNmap([...NMAP_SWEEP_ARGS, ...batch])
      // Only keep devices that actually responded — offline IPs from the same subnet range
      // must never be inserted as new DB rows. Previously-seen devices that go missing
      // will be marked offline by markOffline() below.
      const found = parseNmapOutput(output)
        .filter(d => d.status === 'up')
        .map(d => ({ ...d, status: 'online' }))
      completedBatches++
      onlineCount += found.length
      const percent = Math.round((completedBatches / allBatches.length) * 100)
      if (broadcast) broadcast('scan_progress', { percent, devicesFound: onlineCount })
      return found
    }

    async function runBatchesWithConcurrency(batches, limit) {
      const results = new Array(batches.length)
      let next = 0
      async function worker() {
        while (next < batches.length) {
          const i = next++
          results[i] = await runBatch(batches[i])
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, batches.length) }, worker))
      return results
    }

    const batchResults = await runBatchesWithConcurrency(allBatches, SCAN_CONCURRENCY)
    _scanResults = batchResults.flat()

    // mDNS passive map — populated by the background sniffer
    for (const d of _scanResults) {
      if (!d.hostname && _mdnsMap[d.ip]) d.hostname = _mdnsMap[d.ip]
    }

    // DHCP leases file — most reliable on Pi (dnsmasq)
    const leases = readDhcpLeases()
    for (const d of _scanResults) {
      if (!d.hostname && leases[d.ip]) d.hostname = leases[d.ip]
    }

    // DNS PTR reverse lookup — cross-platform (Windows + Linux), uses system resolver
    // 2s per-IP timeout prevents stalling when router has no PTR records
    const noNameDns = _scanResults.filter(d => !d.hostname && d.status === 'online')
    if (noNameDns.length) {
      const dnsNames = await dnsReverseLookup(noNameDns.map(d => d.ip))
      for (const d of noNameDns) { if (dnsNames[d.ip]) d.hostname = dnsNames[d.ip] }
    }

    // NetBIOS — unicast UDP 137, works cross-subnet (Windows/Samba)
    const noName1 = _scanResults.filter(d => !d.hostname && d.status === 'online')
    if (noName1.length > 0) {
      const nbstat = await nbstatLookup(noName1.map(d => d.ip))
      for (const d of noName1) { if (nbstat[d.ip]) d.hostname = nbstat[d.ip] }
    }

    // Unicast mDNS burst — probe remaining devices on port 5353 (Apple, some Android)
    const noName2 = _scanResults.filter(d => !d.hostname && d.status === 'online')
    await mdnsUnicastBurst(noName2.map(d => d.ip))
    for (const d of noName2) {
      if (!d.hostname && _mdnsMap[d.ip]) d.hostname = _mdnsMap[d.ip]
    }

    _lastScan = Date.now()

    // Snapshot DB state before upsert so we can detect new / came-online devices
    const dbSnapshotBefore = Object.fromEntries(getAllDevices().map(d => [(d.mac ?? `noMAC:${d.ip}`), d]))

    // Persist to DB — upsert online devices, mark absent ones offline
    for (const d of _scanResults) {
      try {
        upsertDevice(d)
      } catch (err) {
        console.error(`[db] upsertDevice failed for ${d.ip} (MAC: ${d.mac ?? 'none'}):`, err.message)
        audit('device.upsert_error', { ip: d.ip, mac: d.mac, error: err.message })
        if (broadcast) broadcast('device_error', { ip: d.ip, mac: d.mac ?? null, error: err.message })
      }
    }

    // Emit per-device lifecycle events
    for (const d of _scanResults) {
      if (d.status !== 'online') continue
      const pk = d.mac ?? `noMAC:${d.ip}`
      const before = dbSnapshotBefore[pk]
      if (!before) {
        auditDevice('device.new', d.mac, d.ip, d.hostname, { vendor: d.vendor })
      } else if (before.status === 'offline') {
        auditDevice('device.online', d.mac, d.ip, d.hostname, {})
      }
    }

    const onlineMacs = _scanResults.filter(d => d.status === 'online').map(d => d.mac ?? `noMAC:${d.ip}`)
    const wentOffline = markOffline(onlineMacs)
    for (const d of wentOffline) {
      auditDevice('device.offline', d.mac, d.ip, d.hostname, {})
    }

    // Auto-dormant devices offline for configured number of days (default 3)
    const newlyDormant = autoDormantStale(loadConfig()?.network?.dormant_after_days ?? 3)
    if (newlyDormant > 0) console.log(`[scan] Auto-dormanted ${newlyDormant} stale device(s).`)

    // Prune phantom devices — IPs that were bulk-inserted as offline by old
    // scan behaviour and have never actually responded to any probe.
    // Keeps devices that hide from ping but have discovered ports (real devices).
    clearPhantomDevices()

    // Merge firstSeen/lastSeen AND all enriched fields (ports, os, vendor, label)
    // from DB back into results so the scan_complete payload is complete.
    // Without this, devices would show ports:[] after a ping-only rescan.
    const dbSnap = Object.fromEntries(getAllDevices().map(d => [d.mac ?? `noMAC:${d.ip}`, d]))
    _scanResults = _scanResults.map(d => {
      const db = dbSnap[d.mac ?? `noMAC:${d.ip}`]
      if (!db) return d
      return {
        ...d,
        firstSeen:   db.firstSeen,
        lastSeen:    db.lastSeen,
        // Preserve enriched fields from DB when fresh scan has no data
        ports:       d.ports?.length       ? d.ports       : db.ports,
        hostScripts: d.hostScripts?.length ? d.hostScripts : db.hostScripts,
        traceroute:  d.traceroute?.length  ? d.traceroute  : db.traceroute,
        os:          d.os  ?? db.os,
        vendor:      d.vendor ?? db.vendor,
        hostname:    d.hostname ?? db.hostname,
        label:       db.label ?? null,
        favorited:   db.favorited ?? false,
        flagged:     db.flagged   ?? false,
        dormant:     db.dormant   ?? false,
        flags:       db.flags     ?? [],
        lastOnline:  db.lastOnline ?? null,
      }
    })

    _gateway = getDefaultGateway()

    // Enrich each device with its detected gateway (from passive ARP sniffer)
    const knownGwIps = [...new Set([
      ...(_gateway ?? []),
      ...Object.keys(loadConfig()?.network?.gateway_assignments ?? {}),
    ])]
    _scanResults = _scanResults.map(d => ({
      ...d,
      detectedGateway: getDetectedGateway(d.ip, knownGwIps),
    }))

    // Include offline devices from DB that weren't seen in this scan,
    // so the scan_complete payload matches what GET /scan returns.
    const onlineIps = new Set(_scanResults.map(d => d.ip))
    const offlineDevices = getAllDevices()
      .filter(d => !onlineIps.has(d.ip))
      .map(d => ({ ...d, detectedGateway: getDetectedGateway(d.ip, knownGwIps) }))

    if (broadcast) broadcast('scan_complete', { devices: [..._scanResults, ...offlineDevices], ts: _lastScan, durationMs: Date.now() - _scanStartMs, gateway: _gateway, gatewayAssignments: loadConfig()?.network?.gateway_assignments ?? {} })
    audit('scan.complete', { devices_found: _scanResults.length, subnets, durationMs: Date.now() - _scanStartMs })
  } catch (err) {
    if (broadcast) broadcast('scan_error', { error: err.message })
    audit('scan.error', { error: err.message })
    throw err
  } finally {
    _scanning = false
  }

  return _scanResults
}

// Fast ping-only scan — exported for server-side cron scheduling
export async function runPingSweep(broadcast) {
  if (_scanning) return []  // Skip if a full scan is already running
  startBackgroundArpSniffer()
  const subnets = getSubnets().filter(s => isPrivateCIDR(s))
  if (!subnets.length) return []
  try {
    const allOutputs = await Promise.all(subnets.map(subnet =>
      runNmap(['-sn', '-PE', '-PP', '-PS22,80,443,8080,3000,8123,9091,5000,1883', '--host-timeout', '3s', '--min-rate', '500', subnet]).catch(() => '')))
    // Keep full parsed data — nmap -sn returns MAC+vendor via ARP for LAN hosts
    const parsed = allOutputs.flatMap(output => parseNmapOutput(output).map(d => ({
      ...d,
      status: d.status === 'up' ? 'online' : 'offline',
    })))

    // mDNS passive map
    for (const d of parsed) {
      if (!d.hostname && _mdnsMap[d.ip]) d.hostname = _mdnsMap[d.ip]
    }

    // NetBIOS — unicast UDP 137, works cross-subnet (Windows/Samba)
    const noName1p = parsed.filter(d => !d.hostname && d.status === 'online')
    if (noName1p.length > 0) {
      const nbstat = await nbstatLookup(noName1p.map(d => d.ip))
      for (const d of noName1p) { if (nbstat[d.ip]) d.hostname = nbstat[d.ip] }
    }

    // Unicast mDNS burst
    const noName2p = parsed.filter(d => !d.hostname && d.status === 'online')
    await mdnsUnicastBurst(noName2p.map(d => d.ip))
    for (const d of noName2p) {
      if (!d.hostname && _mdnsMap[d.ip]) d.hostname = _mdnsMap[d.ip]
    }

    // Snapshot known IPs before upsert so we can detect new arrivals
    const dbBefore = getAllDevices()
    const knownIps = new Set(dbBefore.map(d => d.ip))
    const ipToMac  = Object.fromEntries(dbBefore.map(d => [d.ip, d.mac ?? `noMAC:${d.ip}`]))
    const statusBefore = Object.fromEntries(dbBefore.map(d => [(d.mac ?? `noMAC:${d.ip}`), d.status]))

    // Upsert all online devices — this adds new ones and updates existing ones
    const onlineDevices = parsed.filter(d => d.status === 'online')
    for (const d of onlineDevices) {
      try { upsertDevice(d) } catch { /* ignore per-device errors */ }
    }

    // Mark absent devices offline, keyed by MAC
    const onlineMacs = new Set(
      onlineDevices.map(d => d.mac ?? ipToMac[d.ip]).filter(Boolean)
    )
    const wentOffline = markOffline([...onlineMacs])

    // Emit device lifecycle events
    for (const d of onlineDevices) {
      const pk = d.mac ?? ipToMac[d.ip] ?? `noMAC:${d.ip}`
      if (!knownIps.has(d.ip)) {
        auditDevice('device.new', d.mac, d.ip, d.hostname, { vendor: d.vendor })
      } else if (statusBefore[pk] === 'offline') {
        auditDevice('device.online', d.mac, d.ip, d.hostname, {})
      }
    }
    for (const d of wentOffline) {
      auditDevice('device.offline', d.mac, d.ip, d.hostname, {})
    }

    const knownGwIps = [...new Set([
      ...(_gateway ?? []),
      ...Object.keys(loadConfig()?.network?.gateway_assignments ?? {}),
    ])]
    const enriched = parsed.map(r => ({
      ...r,
      detectedGateway: getDetectedGateway(r.ip, knownGwIps),
    }))

    // Include any newly discovered devices so the frontend can add them live
    const newDevices = getAllDevices()
      .filter(d => !knownIps.has(d.ip))
      .map(d => ({ ...d, detectedGateway: getDetectedGateway(d.ip, knownGwIps) }))

    if (broadcast) broadcast('ping_complete', { results: enriched, newDevices, ts: Date.now() })
    if (broadcast) broadcast('job_done', { job: 'ping', ts: Date.now() })
    return enriched
  } catch {
    return []
  }
}

// Returns the caller's LAN IP as seen by the server — used by the UI to
// highlight the user's own device in the network scan list.
router.get('/myip', (req, res) => {
  // Strip IPv6-mapped IPv4 prefix (::ffff:192.168.x.x) if present
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '') || null
  res.json({ ip })
})

// Returns the caller's LAN IP as seen by the server — used by the UI to
// highlight the user's own device in the network scan list.
router.get('/myip', (req, res) => {
  // Strip IPv6-mapped IPv4 prefix (::ffff:192.168.x.x) if present
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '') || null
  res.json({ ip })
})

// ── Available flags catalogue ──────────────────────────────────────────────────

router.get('/flags', (_req, res) => {
  res.json(getAllFlags())
})

router.post('/flags', (req, res) => {
  const { key, label, icon, description, sortOrder } = req.body ?? {}
  if (!key || !label) return res.status(400).json({ error: 'key and label are required' })
  try {
    const flag = createFlag({ key, label, icon, description, sortOrder })
    res.status(201).json(flag)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.put('/flags/:key', (req, res) => {
  const { key } = req.params
  const { label, icon, description, sortOrder } = req.body ?? {}
  try {
    const flag = updateFlag(key, { label, icon, description, sortOrder })
    res.json(flag)
  } catch (err) {
    const status = err.message === 'Flag not found' ? 404 : err.message.includes('System') ? 403 : 400
    res.status(status).json({ error: err.message })
  }
})

router.delete('/flags/:key', (req, res) => {
  const { key } = req.params
  try {
    deleteFlag(key)
    res.json({ ok: true, key })
  } catch (err) {
    const status = err.message === 'Flag not found' ? 404 : err.message.includes('System') ? 403 : 400
    res.status(status).json({ error: err.message })
  }
})

// ── Toggle any flag on a device (generic endpoint) ────────────────────────────

router.post('/device/:mac/flag/:flagKey', (req, res) => {
  const { mac, flagKey } = req.params
  if (!/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac)) {
    return res.status(400).json({ error: 'Invalid MAC address' })
  }
  if (!/^[a-z0-9_-]{1,32}$/.test(flagKey)) {
    return res.status(400).json({ error: 'Invalid flag key' })
  }
  const active = toggleDeviceFlag(mac, flagKey)
  const idx = _scanResults.findIndex(d => d.mac === mac)
  if (idx !== -1) {
    const flags = active
      ? [...new Set([...((_scanResults[idx].flags) ?? []), flagKey])]
      : ((_scanResults[idx].flags) ?? []).filter(f => f !== flagKey)
    _scanResults[idx] = {
      ..._scanResults[idx],
      flags,
      favorited: flags.includes('favorite'),
      flagged:   flags.includes('pest'),
      dormant:   flags.includes('dormant'),
    }
  }
  res.json({ ok: true, mac, flagKey, active })
})

router.get('/ping', async (req, res) => {
  const subnets = getSubnets()
  const badSubnet = subnets.find(s => !isPrivateCIDR(s))
  if (badSubnet) {
    return res.status(400).json({ error: `Ping blocked: '${badSubnet}' is not a private LAN range.` })
  }
  try {
    const results = await runPingSweep(null)
    res.json({ results, ts: Date.now() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Quick single-host reachability check
router.get('/ping-host', async (req, res) => {
  const { ip } = req.query
  if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP' })
  }
  if (!isPrivateIP(ip)) {
    return res.status(400).json({ error: `'${ip}' is not a private LAN address. Only RFC 1918 addresses may be tested.` })
  }
  try {
    const output = await runNmap(['-sn', '--host-timeout', '3s', ip])
    const results = parseNmapOutput(output)
    const host = results.find(d => d.ip === ip)
    res.json({ online: host?.status === 'up', latency: host?.latency ?? null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/network/traceroute/:ip — run mtr to a specific LAN device
router.post('/traceroute/:ip', (req, res) => {
  const { ip } = req.params
  if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP address' })
  }
  if (!isPrivateIP(ip)) {
    return res.status(400).json({ error: `'${ip}' is not a private LAN address` })
  }
  exec(`mtr --report --no-dns --report-cycles 3 ${ip} 2>&1`, { timeout: 60000 }, (err, stdout) => {
    res.json({ output: stdout || (err?.message ?? 'mtr unavailable') })
  })
})

// Cancel a running scan
router.delete('/scan', (req, res) => {
  for (const p of _scanProcs) { try { p.kill() } catch { /* ignore */ } }
  _scanProcs = []
  _scanning = false
  if (_broadcastRef) _broadcastRef('scan_error', { error: 'Scan cancelled' })
  res.json({ cancelled: true })
})

router.delete('/devices', (req, res) => {
  clearAllDevices()
  _scanResults = []
  audit('devices.cleared')
  res.json({ cleared: true })
})

router.get('/scan', (req, res) => {
  // Merge fresh in-memory results with persisted offline devices not in current scan
  const allDb = getAllDevices()
  const dbMap = Object.fromEntries(allDb.map(d => [d.mac ?? `noMAC:${d.ip}`, d]))
  const onlineIps = new Set(_scanResults.map(d => d.ip))
  // Ensure firstSeen/lastSeen are always present on live results
  const results = _scanResults.map(d => ({
    ...d,
    firstSeen: d.firstSeen ?? dbMap[d.mac ?? `noMAC:${d.ip}`]?.firstSeen ?? null,
    lastSeen:  d.lastSeen  ?? dbMap[d.mac ?? `noMAC:${d.ip}`]?.lastSeen  ?? null,
  }))
  const cfg = loadConfig()
  const gatewayAssignments = cfg?.network?.gateway_assignments ?? {}
  const knownGwIps = [...new Set([
    ...(_gateway ?? getDefaultGateway() ?? []),
    ...Object.keys(gatewayAssignments),
  ])]
  const offlineDevices = allDb.filter(d => !onlineIps.has(d.ip)).map(d => ({
    ...d,
    detectedGateway: getDetectedGateway(d.ip, knownGwIps),
  }))
  res.json({ devices: [...results, ...offlineDevices], lastScan: _lastScan, scanning: _scanning, gateway: _gateway ?? getDefaultGateway(), gatewayAssignments })
})

router.post('/scan', (req, res) => {
  // Non-blocking — results delivered via SSE
  performScan(_broadcastRef).catch(err =>
    console.error('[network] Scan error:', err.message)
  )
  res.json({ started: true, scanning: true })
})

// ── Shared port scan logic (used by on-demand handler + scheduled deep scan) ──

async function scanDevicePorts(ip, broadcast, { noPing = false } = {}) {
  try {
    const output = await runNmap([
      ...(noPing ? ['-Pn'] : []),
      '-sV', '--open',
      '-O', '--osscan-guess',
      '--script', 'http-title,banner,ssl-cert,smb-os-discovery',
      '--script-timeout', '5s',
      '--top-ports', '500',
      '--host-timeout', '60s',
      '--min-rate', '300',
      '--stats-every', '3s',
      '--traceroute',
      ip,
    ], (percent) => {
      if (broadcast) broadcast('port_scan_progress', { ip, percent: percent != null ? Math.round(percent) : null })
    }, (proc) => {
      _portScanProcs.set(ip, proc)
      proc.on('close', () => _portScanProcs.delete(ip))
    })

    const devices = parseNmapOutput(output)
    const result = devices[0] ?? { ip, ports: [], status: 'unknown' }
    if (broadcast) broadcast('port_scan_progress', { ip, percent: 100 })

    if (result.ip) {
      // Detect new ports relative to what DB already has
      const existing = getAllDevices().find(d => d.ip === ip)
      const oldPortSet = new Set((existing?.ports ?? []).map(p => p.port))
      for (const p of (result.ports ?? [])) {
        if (!oldPortSet.has(p.port)) {
          auditDevice('device.port.open',
            result.mac ?? existing?.mac, ip,
            result.hostname ?? existing?.hostname,
            { port: p.port, service: p.service, version: p.version }
          )
        }
      }
      // noPing=true: ICMP was blocked; only persist if ports actually responded
      // (avoids overwriting 'offline' for truly unreachable hosts)
      const portsFound = (result.ports ?? []).length > 0
      if (!noPing || portsFound) {
        const effectiveStatus = noPing ? 'filtered' : 'online'
        try {
          upsertDevice({ ...result, status: effectiveStatus })
          if (noPing && broadcast) broadcast('device_updated', { ip, status: 'filtered' })
        } catch (err) {
          console.error(`[db] upsertDevice failed for ${result.ip} (MAC: ${result.mac ?? 'none'}):`, err.message)
          audit('device.upsert_error', { ip: result.ip, mac: result.mac, error: err.message })
          if (broadcast) broadcast('device_error', { ip: result.ip, mac: result.mac ?? null, error: err.message })
        }
      }
    }
    return result
  } catch (err) {
    if (broadcast) broadcast('port_scan_progress', { ip, percent: null, error: err.message })
    throw err
  }
}

// Deep-scan a single device (triggered on demand)
router.get('/device/:ip', async (req, res) => {
  const { ip } = req.params
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP address' })
  }
  const subnets = getSubnets()
  if (!isPrivateIP(ip) || !subnets.some(s => isPrivateCIDR(s) && ipInCIDR(ip, s))) {
    return res.status(400).json({ error: `'${ip}' is outside all configured subnets. Only devices on your LAN may be scanned.` })
  }
  try {
    const result = await scanDevicePorts(ip, _broadcastRef)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/device/:ip/scan', (req, res) => {
  const { ip } = req.params
  const proc = _portScanProcs.get(ip)
  if (proc) {
    try { proc.kill() } catch { /* ignore */ }
    _portScanProcs.delete(ip)
  }
  if (_broadcastRef) _broadcastRef('port_scan_progress', { ip, percent: null, cancelled: true })
  res.json({ cancelled: true })
})

router.delete('/device/:mac/ports', (req, res) => {
  const { mac } = req.params
  if (!/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.test(mac)) return res.status(400).json({ error: 'Invalid MAC' })
  clearDevicePorts(mac)
  // Also clear from in-memory scan results
  const idx = _scanResults.findIndex(d => d.mac === mac)
  if (idx !== -1) _scanResults[idx] = { ..._scanResults[idx], ports: [], hostScripts: [], traceroute: [] }
  audit('device.ports_cleared', { mac })
  res.json({ cleared: true })
})

// Active TCP connections involving an IP (visible from this monitoring host)
router.get('/connections/:ip', async (req, res) => {
  const { ip } = req.params
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP' })
  }
  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    const { stdout } = await execAsync('netstat -an', { timeout: 5000 })
    const connections = stdout.split('\n')
      .filter(l => l.includes(ip))
      .map(l => {
        const p = l.trim().split(/\s+/)
        const isWin = /^TCP$|^UDP$/i.test(p[0]) && /^\d/.test(p[1]?.[0] ?? '')
        if (isWin) return { proto: p[0], local: p[1], remote: p[2], state: p[3] || '' }
        if (p.length >= 6) return { proto: p[0], local: p[3], remote: p[4], state: p[5] || '' }
        return null
      })
      .filter(Boolean)
    res.json({ connections, ts: Date.now() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Device label (keyed by MAC so it survives IP changes) ─────────────────────

router.put('/device/:mac/label', (req, res) => {
  const { mac } = req.params
  if (!/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac)) {
    return res.status(400).json({ error: 'Invalid MAC address' })
  }
  const { label } = req.body
  if (typeof label !== 'string') return res.status(400).json({ error: 'label must be a string' })
  setDeviceLabel(mac, label)
  // Update in-memory scan results so SSE clients see the change immediately
  const idx = _scanResults.findIndex(d => d.mac === mac)
  if (idx !== -1) _scanResults[idx] = { ..._scanResults[idx], label: label.trim() || null }
  res.json({ ok: true, mac, label: label.trim() || null })
})

// ── Device favorite toggle ─────────────────────────────────────────────────────

router.post('/device/:mac/favorite', (req, res) => {
  const { mac } = req.params
  if (!/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac)) {
    return res.status(400).json({ error: 'Invalid MAC address' })
  }
  const favorited = toggleFavorite(mac)
  const idx = _scanResults.findIndex(d => d.mac === mac)
  if (idx !== -1) _scanResults[idx] = { ..._scanResults[idx], favorited }
  res.json({ ok: true, mac, favorited })
})

// ── Device flagged (pest) toggle ───────────────────────────────────────────────

router.post('/device/:mac/flagged', (req, res) => {
  const { mac } = req.params
  if (!/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac)) {
    return res.status(400).json({ error: 'Invalid MAC address' })
  }
  const flagged = toggleFlagged(mac)
  const idx = _scanResults.findIndex(d => d.mac === mac)
  if (idx !== -1) _scanResults[idx] = { ..._scanResults[idx], flagged }
  res.json({ ok: true, mac, flagged })
})

// ── Device dormant toggle ──────────────────────────────────────────────────────

router.post('/device/:mac/dormant', (req, res) => {
  const { mac } = req.params
  if (!/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac)) {
    return res.status(400).json({ error: 'Invalid MAC address' })
  }
  const dormant = toggleDormant(mac)
  const idx = _scanResults.findIndex(d => d.mac === mac)
  if (idx !== -1) _scanResults[idx] = { ..._scanResults[idx], dormant }
  res.json({ ok: true, mac, dormant })
})

export function setBroadcast(fn) {
  _broadcastRef = fn
}

let _deepScanning = false

/**
 * Full scheduled deep scan: ping sweep all subnets to upsert devices,
 * then port-scan every online device sequentially with SSE progress events.
 * Used by the 4am cron job and the manual "Force Deep Scan" button.
 */
export async function runScheduledDeepScan(broadcast) {
  if (_deepScanning) return
  _deepScanning = true
  const _deepStartMs = Date.now()
  try {
    // Announce immediately so the UI shows a progress bar right away
    if (broadcast) broadcast('deep_scan_started', { total: 0, phase: 'ping', ts: Date.now() })
    audit('deep_scan.started', {})

    // Step 1 — ping sweep (upserts devices, emits device.new/online/offline events)
    const swept = await runPingSweep(broadcast)
    // Track which IPs responded to ping; others may still have open ports (ICMP blocked)
    const onlineIps = new Set(swept.filter(d => d.status === 'online').map(d => d.ip))

    // Step 2 — port-scan ALL known devices, using -Pn for those that didn't ping
    // Devices with open ports but no ping response are marked 'filtered' (orange dot)
    const allToScan = getAllDevices()
    const total = allToScan.length

    // Send updated total now that we know it
    if (broadcast) broadcast('deep_scan_progress', { ip: null, done: 0, total, percent: 0, phase: 'portscan' })

    let done = 0
    for (const device of allToScan) {
      if (!_deepScanning) break
      if (broadcast) broadcast('deep_scan_progress', {
        ip: device.ip,
        hostname: device.hostname ?? null,
        done,
        total,
        percent: Math.round((done / total) * 100),
      })
      try {
        await scanDevicePorts(device.ip, broadcast, { noPing: !onlineIps.has(device.ip) })
      } catch { /* skip unreachable devices */ }
      done++
    }

    audit('deep_scan.complete', { total, done, durationMs: Date.now() - _deepStartMs })
    if (broadcast) broadcast('deep_scan_complete', { total, done, ts: Date.now(), durationMs: Date.now() - _deepStartMs })
  } finally {
    _deepScanning = false
  }
}

// Cancel running deep scan
router.delete('/deep-scan', (req, res) => {
  for (const p of _scanProcs) { try { p.kill() } catch { /* ignore */ } }
  for (const [, p] of _portScanProcs) { try { p.kill() } catch { /* ignore */ } }
  _scanProcs = []
  _portScanProcs.clear()
  _deepScanning = false
  _scanning = false
  if (_broadcastRef) _broadcastRef('deep_scan_complete', { cancelled: true })
  res.json({ cancelled: true })
})

// Trigger deep scan via API (non-blocking, results via SSE)
router.post('/deep-scan', (req, res) => {
  runScheduledDeepScan(_broadcastRef).catch(err =>
    console.error('[network] Deep scan error:', err.message)
  )
  res.json({ started: true })
})

export default router
