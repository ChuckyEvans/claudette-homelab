import { getDb } from '../server/db.js'
import { loadConfig } from '../server/config.js'
import { computeOutagesSummary } from '../server/lib/outages.mjs'

function computeOutages(from, to) {
  const db = getDb()
  const cfg = loadConfig()
  const { outages, totalDowntimeMs, longestMs, totalOutages } = computeOutagesSummary(db, from, to)
  // Attach diagnostics if present
  const diagRows = db.all(`SELECT outage_ts, traceroute, ping_detail, gateway, captured_at, outage_type FROM outage_diagnostics`)
  const diagMap = new Map(diagRows.map(r => [r.outage_ts, r]))
  const pingHosts = cfg?.network?.connectivity_hosts ?? ['1.1.1.1']
  const withDiag = outages.map(o => {
    const d = diagMap.get(o.start)
    if (!d) return o
    let pingDetail = null
    try { pingDetail = JSON.parse(d.ping_detail) } catch {}
    return { ...o, diagnostics: { traceroute: d.traceroute, ping_detail: pingDetail, gateway: d.gateway, ping_hosts: pingHosts, captured_at: d.captured_at } }
  })
  const final = (withDiag.length === 0 && diagRows.length > 0)
    ? diagRows.filter(d => d.outage_ts >= from && d.outage_ts <= to).map(d => {
      let pingDetail = null
      try { pingDetail = JSON.parse(d.ping_detail) } catch {}
      return { start: d.outage_ts, end: d.captured_at ?? null, durationMs: d.captured_at ? (d.captured_at - d.outage_ts) : 0, uptimeBeforeMs: null, outage_type: d.outage_type ?? null, ongoing: false, diagnostics: { traceroute: d.traceroute, ping_detail: pingDetail, gateway: d.gateway, ping_hosts: pingHosts, captured_at: d.captured_at } }
    }).reverse()
    : withDiag
  return { outages: final, totalOutages, totalDowntimeMs, longestMs }
}

const now = Date.now()
const ranges = {
  '7d': [now - 7*24*60*60*1000, now],
  '30d':[now - 30*24*60*60*1000, now],
  '90d':[now - 90*24*60*60*1000, now],
  'full':[0, now]
}

for (const k of Object.keys(ranges)) {
  const [from, to] = ranges[k]
  const res = computeOutages(from, to)
  console.log(JSON.stringify({range: k, from, to, result: res}, null, 2))
}
