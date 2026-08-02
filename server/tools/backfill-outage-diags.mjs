#!/usr/bin/env node
import { getDb } from '../db.js'

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
  let rows = db.all("SELECT ts, payload FROM audit_log WHERE event = 'internet.down' ORDER BY ts ASC")
  console.log('found', rows.length, 'internet.down events')
  let inserted = 0
  for (const r of rows) {
    try {
      let ts = Number(r.ts) || Date.now()
      if (ts < 1e12) ts = Math.round(ts * 1000)
      const p = JSON.parse(r.payload || '{}')
      const pingArr = p.results ?? (Array.isArray(p.attempts) ? p.attempts[0] ?? [] : [])
      const pingDetail = JSON.stringify(pingArr)
      const traceroute = p.traceroute ?? null
      const gateway = p.gateway ?? null
      const outage_type = p.outage_type ?? null

      const exist = db.get('SELECT outage_ts FROM outage_diagnostics WHERE outage_ts = ?', [ts])
      if (exist) continue

      const lastHop = parseLastHop(traceroute) ?? (() => {
        try {
          const parsed = JSON.parse(pingDetail)
          if (Array.isArray(parsed)) {
            for (const e of parsed) if (e && e.ok && e.host) return e.host
          }
        } catch (e) {}
        return null
      })()

      db.run(`INSERT INTO outage_diagnostics (outage_ts, traceroute, traceroute_last_hop, ping_detail, gateway, outage_type, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ts, traceroute, lastHop, pingDetail, gateway, outage_type, ts])
      inserted++
    } catch (e) {
      console.error('row error', e && e.message)
    }
  }
  console.log('inserted', inserted, 'diagnostics rows')
}

main().catch(e => { console.error(e); process.exit(1) })
