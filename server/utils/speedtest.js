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
    server_name:    `Cloudflare ${json.colo ?? ''}`.trim(),
    server_location: [json.city, json.regionCode].filter(Boolean).join(', ') || null,
    server_country: json.country ?? null,
  }
}

/**
 * Run a full speed test and persist the result.
 * Returns the saved row object.
 */
export async function runSpeedTest(broadcast) {
  const ts = Date.now()
  console.log('[speedtest] Starting speed test…')
  let row = { ts, error: null }

  try {
    // 1. Client / server meta
    const meta = await getClientMeta()
    Object.assign(row, meta)

    // 2. Ping — reuse existing ping infrastructure is best, but we can also just
    //    time a small request to 1.1.1.1 via the Cloudflare CDN latency endpoint
    const pingStart = Date.now()
    const pingRes   = await fetchWithTimeout(`${CF_BASE}/__down?bytes=0&measId=0`)
    await pingRes.text()
    row.ping_ms = Date.now() - pingStart

    // 3. Download
    console.log('[speedtest] Measuring download…')
    row.download_mbps = await measureDownload()

    // 4. Upload
    console.log('[speedtest] Measuring upload…')
    row.upload_mbps = await measureUpload()

    console.log(`[speedtest] Done — ↓${row.download_mbps} Mbps ↑${row.upload_mbps} Mbps ping=${row.ping_ms}ms`)
  } catch (err) {
    console.error('[speedtest] Failed:', err.message)
    row.error = err.message
  }

  // Persist
  try {
    const db = getDb()
    db.run(`
      INSERT INTO speedtest_results
        (ts, client_ip, client_isp, client_city, client_country, client_lat, client_lon,
         server_host, server_name, server_location, server_country,
         ping_ms, download_mbps, upload_mbps, error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      row.ts,
      row.client_ip ?? null, row.client_isp ?? null, row.client_city ?? null,
      row.client_country ?? null, row.client_lat ?? null, row.client_lon ?? null,
      row.server_host ?? null, row.server_name ?? null, row.server_location ?? null,
      row.server_country ?? null,
      row.ping_ms ?? null, row.download_mbps ?? null, row.upload_mbps ?? null,
      row.error ?? null,
    ])

    // Audit log entry
    audit('speedtest.run', {
      ping_ms: row.ping_ms,
      download_mbps: row.download_mbps,
      upload_mbps: row.upload_mbps,
      isp: row.client_isp,
      error: row.error ?? undefined,
    })

    // Broadcast SSE event if socket available
    if (broadcast) {
      broadcast('speedtest', {
        ts: row.ts,
        ping_ms: row.ping_ms,
        download_mbps: row.download_mbps,
        upload_mbps: row.upload_mbps,
        isp: row.client_isp,
        error: row.error,
      })
      broadcast('job_done', { job: 'speedtest', ts: Date.now() })
    }
  } catch (dbErr) {
    console.error('[speedtest] DB write failed:', dbErr.message)
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
