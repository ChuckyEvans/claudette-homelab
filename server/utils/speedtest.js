/**
 * Speed test supporting two providers:
 *  - cloudflare (default): pure HTTP, no binary deps, works everywhere
 *  - ookla: Ookla speedtest CLI — auto-selects the lowest-latency server
 *
 * Cloudflare endpoints:
 *  GET  https://speed.cloudflare.com/meta              → client IP, ISP, city, country, lat/lon
 *  GET  https://speed.cloudflare.com/__down?bytes=N    → download test
 *  POST https://speed.cloudflare.com/__up              → upload test
 *
 * Ookla CLI: `speedtest --accept-license --format=json [--interface <iface>]`
 *  Outputs a JSON blob with ping.latency, download.bandwidth, upload.bandwidth,
 *  server.name, server.location, server.country, server.id, isp, interface.externalIp
 */

import { getDb, audit } from '../db.js'
import { loadConfig } from '../config.js'
import { execSync, exec as _execCallback } from 'child_process'
import { promisify } from 'util'
import { promises as dns } from 'dns'
const exec = promisify(_execCallback)

const CF_BASE = 'https://speed.cloudflare.com'
const DOWNLOAD_BYTES   = 25_000_000   // 25 MB per stream
const UPLOAD_BYTES     = 10_000_000   // 10 MB per stream
const PARALLEL_STREAMS = 4            // concurrent streams (saturates high-bandwidth connections)
const TIMEOUT_MS       = 45_000       // 45 s per test phase

// Cloudflare speed endpoints reject headless requests without a browser UA
const CF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Origin': 'https://speed.cloudflare.com',
  'Referer': 'https://speed.cloudflare.com/',
}

/** Fetch with a hard timeout */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...CF_HEADERS, ...(options.headers ?? {}) },
      signal: controller.signal,
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}

/** Measure download speed using parallel streams to saturate high-bandwidth connections */
async function measureDownload() {
  const start = Date.now()
  const streams = Array.from({ length: PARALLEL_STREAMS }, (_, i) =>
    fetchWithTimeout(`${CF_BASE}/__down?bytes=${DOWNLOAD_BYTES}&measId=${i}`)
      .then(res => { if (!res.ok) throw new Error(`Download test HTTP ${res.status}`); return res.arrayBuffer() })
  )
  const buffers = await Promise.all(streams)
  const elapsed = (Date.now() - start) / 1000
  const totalBytes = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  return parseFloat(((totalBytes * 8) / elapsed / 1_000_000).toFixed(2))  // Mbps
}

/** Measure upload speed using parallel streams */
async function measureUpload() {
  const start = Date.now()
  const streams = Array.from({ length: PARALLEL_STREAMS }, () => {
    const body = new Uint8Array(UPLOAD_BYTES)
    crypto.getRandomValues(body.slice(0, Math.min(65536, UPLOAD_BYTES)))
    return fetchWithTimeout(`${CF_BASE}/__up`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    }).then(res => { if (!res.ok) throw new Error(`Upload test HTTP ${res.status}`); return res.text() })
  })
  await Promise.all(streams)
  const elapsed = (Date.now() - start) / 1000
  return parseFloat(((UPLOAD_BYTES * PARALLEL_STREAMS * 8) / elapsed / 1_000_000).toFixed(2))
}

/** Get client meta info from Cloudflare */
async function getClientMeta() {
  const res  = await fetchWithTimeout(`${CF_BASE}/meta`)
  if (!res.ok) throw new Error(`Meta HTTP ${res.status}`)
  const json = await res.json()
  const lat  = parseFloat(json.latitude)
  const lon  = parseFloat(json.longitude)
  return {
    client_ip:       json.clientIp          ?? null,
    client_isp:      json.asOrganization    ?? json.isp ?? null,
    client_city:     json.city              ?? null,
    client_country:  json.country           ?? null,
    client_lat:      Number.isFinite(lat) ? lat : null,
    client_lon:      Number.isFinite(lon) ? lon : null,
    server_host:     'speed.cloudflare.com',
    server_name:     `Cloudflare ${typeof json.colo === 'string' ? json.colo : (json.colo?.code ?? json.colo?.iata ?? '')}`.trim(),
    server_location: [json.city, json.regionCode].filter(Boolean).join(', ') || null,
    server_country:  json.country ?? null,
  }
}

/**
 * Auto-detect an active VPN/tunnel interface when none is configured.
 * Looks for any UP tun*, tap*, wg*, or ppp* interface.
 */
function detectActiveVpnInterface() {
  if (process.platform === 'win32') return null
  try {
    const out = execSync('ip link show', { timeout: 2000 }).toString()
    for (const match of out.matchAll(/^\d+:\s+(\S+?)(@\S+)?:\s+<([^>]+)>/gm)) {
      const name  = match[1]
      const flags = match[3]
      if (/^(tun|tap|wg|ppp)/.test(name) && flags.includes('UP')) return name
    }
  } catch { /* ignore */ }
  return null
}

/** Returns true if a network interface is UP (Linux only) */
export function isInterfaceUp(iface) {
  if (process.platform === 'win32') return false
  try {
    const out = execSync(`ip link show ${iface} 2>/dev/null`, { timeout: 1000 }).toString()
    return out.length > 0 && /<[^>]*\bUP\b[^>]*>/.test(out)
  } catch { return false }
}

/**
 * Detect the physical (non-VPN, non-loopback) interface that carries the real ISP traffic.
 * Used to bind the direct speedtest when a VPN is active and has hijacked the default route.
 * Returns null on Windows or if detection fails (falls back to unbound fetch).
 */
function detectPhysicalInterface(vpnIface) {
  if (process.platform === 'win32') return null
  try {
    // Get all interfaces from `ip link show`
    const out = execSync('ip link show', { timeout: 2000 }).toString()
    // Parse lines like: "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> ..."
    const candidates = []
    for (const match of out.matchAll(/^\d+:\s+(\S+?)(@\S+)?:\s+<([^>]+)>/gm)) {
      const name  = match[1]
      const flags = match[3]
      if (name === 'lo') continue               // skip loopback
      if (name === vpnIface) continue           // skip the VPN iface itself
      // Skip common VPN/tunnel prefixes
      if (/^(tun|tap|wg|ppp|veth|docker|br-|virbr|dummy)/.test(name)) continue
      if (!flags.includes('UP')) continue       // must be UP
      candidates.push(name)
    }
    // Prefer the one that carries the default route
    try {
      const routeOut = execSync('ip route show default', { timeout: 2000 }).toString()
      for (const c of candidates) {
        if (routeOut.includes(`dev ${c}`)) return c
      }
    } catch { /* ignore */ }
    return candidates[0] ?? null
  } catch { return null }
}

/**
 * Find the LAN gateway for `iface`, bypassing any VPN-hijacked default route.
 * Tries: (1) explicit default route via iface, (2) reachable ARP neighbour,
 * (3) conventional .1 address inferred from the iface's own IP.
 */
async function detectGatewayForIface(iface) {
  try {
    const { stdout } = await exec(`ip route show default dev ${iface} 2>/dev/null`, { timeout: 2000 })
    const m = stdout.match(/default via (\d{1,3}(?:\.\d{1,3}){3})/)
    if (m) return m[1]
  } catch { /* ignore */ }
  try {
    const { stdout } = await exec(`ip neigh show dev ${iface} nud reachable 2>/dev/null | awk '{print $1}' | head -1`, { timeout: 2000 })
    const ip = stdout.trim()
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return ip
  } catch { /* ignore */ }
  try {
    const { stdout } = await exec(`ip -4 addr show dev ${iface} 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -1`, { timeout: 2000 })
    const ip = stdout.trim()
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d+$/, '.1')
  } catch { /* ignore */ }
  return null
}

/** Fetch Cloudflare /meta via a specific interface using curl */
export async function getClientMetaVia(iface) {
  try {
    const { stdout } = await exec(
      `curl --interface ${iface} -s --max-time 8 ` +
      `-H "User-Agent: Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" ` +
      `-H "Accept: */*" ` +
      `-H "Origin: https://speed.cloudflare.com" ` +
      `-H "Referer: https://speed.cloudflare.com/" ` +
      `"${CF_BASE}/meta"`,
      { timeout: 10000 }
    )
    const json = JSON.parse(stdout)
    const lat = parseFloat(json.latitude)
    const lon = parseFloat(json.longitude)
    return {
      client_ip:       json.clientIp          ?? null,
      client_isp:      json.asOrganization    ?? json.isp ?? null,
      client_city:     json.city              ?? null,
      client_country:  json.country           ?? null,
      client_lat:      Number.isFinite(lat) ? lat : null,
      client_lon:      Number.isFinite(lon) ? lon : null,
      server_host:     'speed.cloudflare.com',
      server_name:     `Cloudflare ${typeof json.colo === 'string' ? json.colo : (json.colo?.code ?? json.colo?.iata ?? '')}`.trim(),
      server_location: [json.city, json.regionCode].filter(Boolean).join(', ') || null,
      server_country:  json.country ?? null,
    }
  } catch {
    return {}
  }
}

/**
 * Run a speed test bound to a specific network interface using curl.
 * Returns { ping_ms, download_mbps, upload_mbps } or throws on failure.
 */
async function runSpeedTestVia(iface) {
  // Ping: time-to-first-byte of a zero-byte download
  const { stdout: pingOut } = await exec(
    `curl --interface ${iface} -s -o /dev/null -w "%{time_starttransfer}" --max-time 5 "${CF_BASE}/__down?bytes=0"`,
    { timeout: 8000 }
  )
  const ping_ms = Math.round(parseFloat(pingOut) * 1000)

  // Download: curl reports bytes/sec via speed_download
  const { stdout: downOut } = await exec(
    `curl --interface ${iface} -s -o /dev/null -w "%{speed_download}" --max-time 35 "${CF_BASE}/__down?bytes=${DOWNLOAD_BYTES}"`,
    { timeout: 38000 }
  )
  const download_mbps = parseFloat(((parseFloat(downOut) * 8) / 1_000_000).toFixed(2))

  // Upload: pipe random data into curl
  const { stdout: upOut } = await exec(
    `dd if=/dev/urandom bs=1048576 count=10 2>/dev/null | curl --interface ${iface} -X POST -s -o /dev/null -w "%{speed_upload}" -H "Content-Type: application/octet-stream" --data-binary @- --max-time 35 "${CF_BASE}/__up"`,
    { timeout: 40000 }
  )
  const upload_mbps = parseFloat(((parseFloat(upOut) * 8) / 1_000_000).toFixed(2))

  return { ping_ms, download_mbps, upload_mbps }
}

/**
 * Check whether the Ookla speedtest CLI is available on PATH.
 */
export function isOoklaAvailable() {
  try {
    execSync('speedtest --version', { timeout: 3000, stdio: 'ignore' })
    return true
  } catch { return false }
}

/**
 * Returns true if a server name appears to be hosted by the client's ISP.
 * Strips AS numbers and punctuation, then checks for shared significant words.
 */
function ownedByClientIsp(serverName, clientIsp) {
  if (!serverName || !clientIsp) return false
  const clean = s => s.toLowerCase().replace(/\bas\d+\b/g, '').replace(/[^a-z0-9 ]/g, ' ')
  const ispWords = clean(clientIsp).split(/\s+/).filter(w => w.length > 3)
  const svrText  = clean(serverName)
  return ispWords.some(w => svrText.includes(w))
}

/**
 * List nearby Ookla speedtest servers.
 * Returns an array of { id, name, location, country, host } or [] on failure.
 */
async function getOoklaServers(iface) {
  const ifaceFlag = iface ? `--interface ${iface}` : ''
  // `-L`/`--servers` lists nearby servers without running a test
  const cmd = `speedtest --accept-license --accept-gdpr --format=json --servers ${ifaceFlag}`.trim()
  let stdout = ''
  try {
    ;({ stdout } = await exec(cmd, { timeout: 30_000 }))
  } catch {
    return []
  }
  // CLI emits a single JSON object: { type: "serverList", servers: [...] }
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const obj = JSON.parse(t)
      if (Array.isArray(obj)) return obj
      if (obj.type === 'serverList' && Array.isArray(obj.servers)) return obj.servers
    } catch { /* skip non-JSON lines */ }
  }
  return []
}

/**
 * Run a speed test using the Ookla CLI.
 * @param {string|null} iface      Network interface to bind to (null = default route)
 * @param {string|null} clientIsp  Client ISP name used to skip same-network servers
 * @returns {{ ping_ms, download_mbps, upload_mbps, client_ip, client_isp,
 *             server_name, server_location, server_country, server_id }}
 */
async function runOoklaSpeedTest(iface, clientIsp = null) {
  const ifaceFlag = iface ? `--interface ${iface}` : ''

  // Prefer a third-party server to avoid biased same-ISP results.
  // Only fall back to an ISP-owned server if no other options exist.
  let serverFlag = ''
  if (clientIsp) {
    try {
      const servers = await getOoklaServers(iface)
      if (servers.length > 0) {
        const nonIsp = servers.filter(s => !ownedByClientIsp(s.name, clientIsp))
        if (nonIsp.length > 0) {
          serverFlag = `--server-id ${nonIsp[0].id}`
          console.log(`[speedtest] Ookla: skipping ISP servers — using "${nonIsp[0].name}" (${nonIsp[0].location})`)
        } else {
          console.warn('[speedtest] Ookla: all nearby servers belong to client ISP — using auto-select (last resort)')
        }
      }
    } catch (e) {
      console.warn('[speedtest] Ookla: server list fetch failed:', e.message)
    }
  }

  const cmd = `speedtest --accept-license --accept-gdpr --format=json ${ifaceFlag} ${serverFlag}`.trim()
  const { stdout } = await exec(cmd, { timeout: 120_000 })
  const j = JSON.parse(stdout)
  if (j.type === 'log' || j.type === 'progress') throw new Error('Unexpected Ookla output format')
  // Ookla reports bandwidth in bytes/s
  const download_mbps = parseFloat(((j.download?.bandwidth ?? 0) * 8 / 1_000_000).toFixed(2))
  const upload_mbps   = parseFloat(((j.upload?.bandwidth   ?? 0) * 8 / 1_000_000).toFixed(2))
  const ping_ms       = Math.round(j.ping?.latency ?? 0)
  return {
    provider:         'ookla',
    ping_ms,
    download_mbps,
    upload_mbps,
    client_ip:        j.interface?.externalIp   ?? null,
    client_isp:       j.isp                     ?? null,
    client_city:      null,
    client_country:   j.server?.country         ?? null,
    client_lat:       null,
    client_lon:       null,
    server_host:      j.server?.host            ?? null,
    server_name:      j.server?.name ? `${j.server.name} (${j.server.id})` : null,
    server_location:  j.server?.location        ?? null,
    server_country:   j.server?.country         ?? null,
  }
}

/** Persist a speed test row and write an audit entry */
function persistSpeedTestRow(row) {
  try {
    getDb().run(`
      INSERT INTO speedtest_results
        (ts, client_ip, client_isp, client_city, client_country, client_lat, client_lon,
         server_host, server_name, server_location, server_country,
         ping_ms, download_mbps, upload_mbps, error, via, provider)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      row.ts,
      row.client_ip ?? null, row.client_isp ?? null, row.client_city ?? null,
      row.client_country ?? null, row.client_lat ?? null, row.client_lon ?? null,
      row.server_host ?? null, row.server_name ?? null, row.server_location ?? null,
      row.server_country ?? null,
      row.ping_ms ?? null, row.download_mbps ?? null, row.upload_mbps ?? null,
      row.error ?? null, row.via ?? 'direct', row.provider ?? 'cloudflare',
    ])
    audit('speedtest.run', {
      via:           row.via ?? 'direct',
      provider:      row.provider ?? 'cloudflare',
      ping_ms:       row.ping_ms,
      download_mbps: row.download_mbps,
      upload_mbps:   row.upload_mbps,
      isp:           row.client_isp,
      error:         row.error ?? undefined,
    })
  } catch (dbErr) {
    console.error('[speedtest] DB write failed:', dbErr.message)
  }
}

/**
 * Run a direct (ISP) speed test and persist the result.
 * VPN tests are run separately via runVpnSpeedTest() (manual only).
 * Returns the direct test row object.
 */
export async function runSpeedTest(broadcast) {
  const ts = Date.now()
  const provider = loadConfig()?.schedule?.speedtest_provider ?? 'cloudflare'
  console.log(`[speedtest] Starting direct speed test… (provider: ${provider})`)
  let row = { ts, via: 'direct', provider, error: null }

  // Detect VPN early — if it's up we must bind the direct test to the physical interface
  // to prevent the VPN's default route from hijacking the "direct" measurement.
  // Fall back to auto-detection if vpn_interface is not set in config (e.g. persisted config
  // pre-dates the field) so we still bypass the VPN even without explicit configuration.
  const VPN_IFACE = loadConfig()?.network?.vpn_interface ?? detectActiveVpnInterface()
  const vpnActive = VPN_IFACE ? isInterfaceUp(VPN_IFACE) : false
  const physIface = vpnActive ? detectPhysicalInterface(VPN_IFACE) : null

  if (vpnActive && physIface) {
    console.log(`[speedtest] VPN (${VPN_IFACE}) is active — binding direct test to physical interface: ${physIface}`)
  } else if (vpnActive) {
    console.warn(`[speedtest] VPN (${VPN_IFACE}) is active but could not detect physical interface — direct test may measure VPN throughput`)
  }

  // When VPN hijacks the default route, curl --interface only sets the source IP — the kernel
  // still routes via tun0 (VPN's /1 routes beat the /0 default). Fix: inject a temporary /32
  // host-route for speed.cloudflare.com via the physical gateway so our traffic truly bypasses
  // the VPN. A /32 is more specific than both /1 routes and wins the longest-prefix match.
  // Requires CAP_NET_ADMIN (container is started with --cap-add NET_ADMIN).
  let _tempRouteIp = null
  if (vpnActive && physIface) {
    try {
      const gw = await detectGatewayForIface(physIface)
      if (gw) {
        const { address: cfIp } = await dns.lookup('speed.cloudflare.com')
        if (cfIp && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(cfIp)) {
          await exec(`ip route replace ${cfIp}/32 via ${gw} dev ${physIface}`, { timeout: 2000 })
          _tempRouteIp = cfIp
          console.log(`[speedtest] Direct route injected: ${cfIp}/32 via ${gw} dev ${physIface}`)
        }
      }
    } catch (e) {
      console.warn('[speedtest] Could not inject direct route:', e.message)
    }
  }

  try {
    if (provider === 'ookla') {
      // Pre-fetch client ISP so we can skip same-network servers
      let clientIsp = null
      try {
        const meta = vpnActive && physIface
          ? await getClientMetaVia(physIface)
          : await getClientMeta()
        clientIsp = meta.client_isp ?? null
        Object.assign(row, meta)
      } catch (e) {
        console.warn('[speedtest] Meta fetch before Ookla failed:', e.message)
      }
      const result = await runOoklaSpeedTest(vpnActive && physIface ? physIface : null, clientIsp)
      Object.assign(row, result)
    } else if (physIface) {
      // VPN is up: bind direct test to physical interface via curl so we measure real ISP speed
      const meta = await getClientMetaVia(physIface)
      Object.assign(row, meta)
      const result = await runSpeedTestVia(physIface)
      Object.assign(row, result)
    } else {
      // No VPN (or VPN detection failed): use Node.js fetch as before
      // 1. Client / server meta
      const meta = await getClientMeta()
      Object.assign(row, meta)

      // 2. Ping — time a zero-byte request to Cloudflare CDN
      const pingStart = Date.now()
      const pingRes   = await fetchWithTimeout(`${CF_BASE}/__down?bytes=0&measId=0`)
      await pingRes.text()
      row.ping_ms = Date.now() - pingStart

      // 3. Download
      console.log('[speedtest] Measuring download (direct)…')
      row.download_mbps = await measureDownload()

      // 4. Upload
      console.log('[speedtest] Measuring upload (direct)…')
      row.upload_mbps = await measureUpload()
    }

    console.log(`[speedtest] Direct — ↓${row.download_mbps} Mbps ↑${row.upload_mbps} Mbps ping=${row.ping_ms}ms`)
  } catch (err) {
    console.error('[speedtest] Direct failed:', err.message)
    row.error = err.message
  } finally {
    // Always remove the temporary host-route so it doesn't linger
    if (_tempRouteIp) {
      exec(`ip route del ${_tempRouteIp}/32 2>/dev/null`, { timeout: 2000 }).catch(() => {})
      console.log(`[speedtest] Direct route removed: ${_tempRouteIp}/32`)
    }
  }

  persistSpeedTestRow(row)

  // Broadcast SSE event
  if (broadcast) {
    broadcast('speedtest', {
      ts: row.ts,
      via: 'direct',
      provider: row.provider ?? 'cloudflare',
      ping_ms: row.ping_ms,
      download_mbps: row.download_mbps,
      upload_mbps: row.upload_mbps,
      isp: row.client_isp,
      error: row.error,
    })
    broadcast('job_done', { job: 'speedtest', ts: Date.now() })
  }

  return row
}

/**
 * Run a VPN speed test on demand and persist the result.
 * Only runs if vpn_interface is configured and the interface is up.
 * Returns the VPN test row object.
 */
export async function runVpnSpeedTest(broadcast) {
  const VPN_IFACE = loadConfig()?.network?.vpn_interface ?? null
  if (!VPN_IFACE) throw new Error('No vpn_interface configured in config.yaml')
  if (!isInterfaceUp(VPN_IFACE)) throw new Error(`${VPN_IFACE} is not up`)

  console.log(`[speedtest] Starting VPN speed test via ${VPN_IFACE}…`)
  const provider = loadConfig()?.schedule?.speedtest_provider ?? 'cloudflare'
  const row = { ts: Date.now(), via: 'vpn', provider, error: null }
  try {
    if (provider === 'ookla') {
      // Pre-fetch client ISP so we can skip same-network servers
      let clientIsp = null
      try {
        const meta = await getClientMetaVia(VPN_IFACE)
        clientIsp = meta.client_isp ?? null
        Object.assign(row, meta)
      } catch { /* ignore — ISP filtering is best-effort */ }
      const result = await runOoklaSpeedTest(VPN_IFACE, clientIsp)
      Object.assign(row, result)
    } else {
      const vpnMeta = await getClientMetaVia(VPN_IFACE)
      Object.assign(row, vpnMeta)
      const result = await runSpeedTestVia(VPN_IFACE)
      Object.assign(row, result)
    }
    console.log(`[speedtest] VPN — ↓${row.download_mbps} Mbps ↑${row.upload_mbps} Mbps ping=${row.ping_ms}ms`)
  } catch (err) {
    console.error('[speedtest] VPN test failed:', err.message)
    row.error = err.message
  }

  persistSpeedTestRow(row)

  if (broadcast) {
    broadcast('speedtest', {
      ts: row.ts,
      via: 'vpn',
      provider: row.provider ?? 'cloudflare',
      ping_ms: row.ping_ms,
      download_mbps: row.download_mbps,
      upload_mbps: row.upload_mbps,
      isp: row.client_isp,
      error: row.error,
    })
    broadcast('job_done', { job: 'speedtest', ts: Date.now() })
  }

  return row
}

/** Return recent speed test results for API/reporting */
export function getSpeedTestHistory(from, to, limit = 100, offset = 0) {
  const db = getDb()
  const rows = db.all(`
    SELECT * FROM speedtest_results
    WHERE ts >= ? AND ts <= ? AND error IS NULL
    ORDER BY ts DESC LIMIT ? OFFSET ?
  `, [from, to, Math.min(limit, 500), offset])

  const total = db.get(`
    SELECT COUNT(*) AS n FROM speedtest_results
    WHERE ts >= ? AND ts <= ? AND error IS NULL
  `, [from, to]).n

  return { rows, total }
}
