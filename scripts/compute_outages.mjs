import { getDb } from '../server/db.js'
import { loadConfig } from '../server/config.js'

const db = getDb()
const to = Date.now()
const from = to - 7*24*60*60*1000

// Pull ALL down/up transitions (not windowed) so we can pair them correctly
let events = db.all(`SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`)

const outages = []
let downTs = null
let downType = null
let lastUpTs = null

if (!events || events.length === 0) {
  const checks = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC`)
  for (const c of checks) {
    let p = null
    try { p = JSON.parse(c.payload) } catch { p = null }
    const ok = p ? Boolean(p.ok) : false
    if (!ok && downTs === null) {
      downTs = c.ts
      downType = p?.outage_type ?? null
    } else if (ok && downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: c.ts, durationMs: c.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
      lastUpTs = c.ts
      downTs = null
      downType = null
    } else if (ok) {
      lastUpTs = c.ts
    }
  }
} else {
  for (const e of events) {
    if (e.event === 'internet.down' && downTs === null) {
      downTs = e.ts
      try { const p = JSON.parse(e.payload); downType = p.outage_type ?? null } catch { downType = null }
    } else if (e.event === 'internet.up' && downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
      lastUpTs = e.ts
      downTs = null
      downType = null
    } else if (e.event === 'internet.up') {
      lastUpTs = e.ts
    }
  }
}

const windowed = outages.filter(o => (!o.end || o.end >= from) && o.start <= to).reverse()
const diagRows = db.all(`SELECT outage_ts, traceroute, ping_detail, gateway, captured_at, outage_type FROM outage_diagnostics`)
const diagMap = new Map(diagRows.map(r => [r.outage_ts, r]))
const cfg = loadConfig()
let windowedWithDiag = windowed.map(o => {
  const d = diagMap.get(o.start)
  if (!d) return o
  let pingDetail = null
  try { pingDetail = JSON.parse(d.ping_detail) } catch {}
  const pingHosts = cfg?.network?.connectivity_hosts ?? ['1.1.1.1']
  return { ...o, diagnostics: { traceroute: d.traceroute, ping_detail: pingDetail, gateway: d.gateway, ping_hosts: pingHosts, captured_at: d.captured_at } }
})

if ((!windowedWithDiag || windowedWithDiag.length === 0) && diagRows && diagRows.length > 0) {
  windowedWithDiag = diagRows
    .filter(d => d.outage_ts >= from && d.outage_ts <= to)
    .map(d => {
      let pingDetail = null
      try { pingDetail = JSON.parse(d.ping_detail) } catch {}
      const pingHosts = cfg?.network?.connectivity_hosts ?? ['1.1.1.1']
      return { start: d.outage_ts, end: d.captured_at ?? null, durationMs: d.captured_at ? (d.captured_at - d.outage_ts) : 0, uptimeBeforeMs: null, outage_type: d.outage_type ?? null, ongoing: false, diagnostics: { traceroute: d.traceroute, ping_detail: pingDetail, gateway: d.gateway, ping_hosts: pingHosts, captured_at: d.captured_at } }
    }).reverse()
}

const totalDowntimeMs = windowedWithDiag.reduce((s, o) => s + (o.durationMs || 0), 0)
const longestMs = windowedWithDiag.length ? Math.max(...windowedWithDiag.map(o => o.durationMs || 0)) : 0

console.log(JSON.stringify({ outages: windowedWithDiag, totalOutages: windowedWithDiag.length, totalDowntimeMs, longestMs }, null, 2))
