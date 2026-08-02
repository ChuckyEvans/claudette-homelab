#!/usr/bin/env node
import { getDb } from '../server/db.js'

function parseLastHop(tracerouteText) {
  if (!tracerouteText) return null
  const lines = tracerouteText.split('\n').map(l => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/\b(\d{1,3}(?:\.\d{1,3}){3}|[a-zA-Z0-9._-]+)\b/)
    if (m) {
      const candidate = m[1]
      if (candidate !== '???' && candidate !== '*') return candidate
    }
  }
  return null
}

async function main() {
  const db = getDb()
  const rows = db.all('SELECT outage_ts, traceroute, ping_detail FROM outage_diagnostics ORDER BY outage_ts ASC')
  console.log('found', rows.length, 'diagnostic rows to inspect')
  let updated = 0
  for (const r of rows) {
    try {
      const existing = db.get('SELECT traceroute_last_hop FROM outage_diagnostics WHERE outage_ts = ?', [r.outage_ts])
      if (existing && existing.traceroute_last_hop) continue
      let lastHop = parseLastHop(r.traceroute)
      if (!lastHop && r.ping_detail) {
        try {
          const p = JSON.parse(r.ping_detail)
          if (Array.isArray(p)) {
            for (const e of p) { if (e && e.ok && e.host) { lastHop = e.host; break } }
          }
        } catch { /* ignore */ }
      }
      if (lastHop) {
        db.run('UPDATE outage_diagnostics SET traceroute_last_hop = ? WHERE outage_ts = ?', [lastHop, r.outage_ts])
        updated++
      }
    } catch (e) { console.error('row error', e && e.message) }
  }
  console.log('updated', updated, 'rows with traceroute_last_hop')
}

main().catch(e => { console.error(e); process.exit(1) })
