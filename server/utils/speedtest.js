/**
 * Speed test using Cloudflare's speed test infrastructure.
 * No binary dependencies — pure HTTP. Works on any platform including ARM64.
 *
 * Endpoints:
 *  GET  https://speed.cloudflare.com/meta              → client IP, ISP, city, country, lat/lon
 *  GET  https://speed.cloudflare.com/__down?bytes=N    → download test (measures throughput)
 *  POST https://speed.cloudflare.com/__up              → upload test
 */

import { getDb, audit } from '../db.js'
import { loadConfig } from '../config.js'
import { execSync, exec as _execCallback } from 'child_process'
import { promisify } from 'util'
import { promises as dns } from 'dns'
const exec = promisify(_execCallback)

const CF_BASE = 'https://speed.cloudflare.com'
const DOWNLOAD_BYTES = 25_000_000   // 25 MB
const UPLOAD_BYTES   = 10_000_000   // 10 MB
const TIMEOUT_MS     = 30_000       // 30 s per test phase

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

/** Measure download speed: fetch DOWNLOAD_BYTES, time it, return Mbps */
async function measureDownload() {
  const start = Date.now()
  const res   = await fetchWithTimeout(`${CF_BASE}/__down?bytes=${DOWNLOAD_BYTES}&measId=0`)
  if (!res.ok) throw new Error(`Download test HTTP ${res.status}`)
  // Drain body fully
  const buf = await res.arrayBuffer()
  const elapsed = (Date.now() - start) / 1000  // seconds
  const bytes   = buf.byteLength
  return parseFloat(((bytes * 8) / elapsed / 1_000_000).toFixed(2))  // Mbps
}

/** Measure upload speed: POST UPLOAD_BYTES of random data, return Mbps */
async function measureUpload() {
  // Generate random data
  const body  = new Uint8Array(UPLOAD_BYTES)
  crypto.getRandomValues(body.slice(0, Math.min(65536, UPLOAD_BYTES))) // seed first 64k

  const start = Date.now()
  const res   = await fetchWithTimeout(`${CF_BASE}/__up`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  })
  if (!res.ok) throw new Error(`Upload test HTTP ${res.status}`)
  await res.text()
  const elapsed = (Date.now() - start) / 1000
  return parseFloat(((UPLOAD_BYTES * 8) / elapsed / 1_000_000).toFixed(2))
}

/** Get client meta info from Cloudflare */
async function getClientMeta() {
  const res  = await fetchWithTimeout(`${CF_BASE}/meta`)
  if (!res.ok) throw new Error(`Meta HTTP ${res.status}`)
  const json = await res.json()
  return {
    client_ip:      json.clientIp      ?? null,
    client_isp:     json.asOrganization ?? json.isp ?? null,
    client_city:    json.city          ?? null,
    client_country: json.country       ?? null,
    client_lat:     typeof json.latitude  === 'number' ? json.latitude  : null,
    client_lon:     typeof json.longitude === 'number' ? json.longitude : null,
    server_host:    'speed.cloudflare.com',
    server_name:    `Cloudflare ${typeof json.colo === 'string' ? json.colo : (json.colo?.code ?? json.colo?.iata ?? '')}`.trim(),
    server_location: [json.city, json.regionCode].filter(Boolean).join(', ') || null,
    server_country: json.country ?? null,
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
      `curl --interface ${iface} -s --max-time 8 -H "Accept: application/json" "${CF_BASE}/meta"`,
      { timeout: 10000 }
    )
    const json = JSON.parse(stdout)
    return {
      client_ip:      json.clientIp          ?? null,
      client_isp:     json.asOrganization    ?? json.isp ?? null,
      client_city:    json.city              ?? null,
      client_country: json.country           ?? null,
      client_lat:     typeof json.latitude  === 'number' ? json.latitude  : null,
      client_lon:     typeof json.longitude === 'number' ? json.longitude : null,
      server_host:    'speed.cloudflare.com',
      server_name:    `Cloudflare ${typeof json.colo === 'string' ? json.colo : (json.colo?.code ?? json.colo?.iata ?? '')}`.trim(),
      server_location: [json.city, json.regionCode].filter(Boolean).join(', ') || null,
      server_country: json.country ?? null,
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

/** Persist a speed test row and write an audit entry */
function persistSpeedTestRow(row) {
  try {
    getDb().run(`
      INSERT INTO speedtest_results
        (ts, client_ip, client_isp, client_city, client_country, client_lat, client_lon,
         server_host, server_name, server_location, server_country,
         ping_ms, download_mbps, upload_mbps, error, via)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      row.ts,
      row.client_ip ?? null, row.client_isp ?? null, row.client_city ?? null,
      row.client_country ?? null, row.client_lat ?? null, row.client_lon ?? null,
      row.server_host ?? null, row.server_name ?? null, row.server_location ?? null,
      row.server_country ?? null,
      row.ping_ms ?? null, row.download_mbps ?? null, row.upload_mbps ?? null,
      row.error ?? null, row.via ?? 'direct',
    ])
    audit('speedtest.run', {
      via:           row.via ?? 'direct',
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
  console.log('[speedtest] Starting direct speed test…')
  let row = { ts, via: 'direct', error: null }

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
    if (physIface) {
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
  const vpnMeta = await getClientMetaVia(VPN_IFACE)
  const row = { ts: Date.now(), via: 'vpn', error: null, ...vpnMeta }
  try {
    const result = await runSpeedTestVia(VPN_IFACE)
    Object.assign(row, result)
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
