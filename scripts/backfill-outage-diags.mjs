#!/usr/bin/env node
import { getDbPath, getDb } from '../server/db.js'

async function main() {
  const db = getDb()
  const rows = db.all("SELECT ts, payload FROM audit_log WHERE event = 'internet.down' ORDER BY ts ASC")
  console.log('found', rows.length, 'internet.down events')
  let inserted = 0
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload || '{}')
      const pingDetail = JSON.stringify(p.results ?? (Array.isArray(p.attempts) ? p.attempts[0] ?? [] : []))
      const traceroute = p.traceroute ?? null
      const gateway = p.gateway ?? null
      const outage_type = p.outage_type ?? null
      const ts = r.ts
      const exist = db.get('SELECT outage_ts FROM outage_diagnostics WHERE outage_ts = ?', [ts])
      if (exist) continue
      db.run(`INSERT INTO outage_diagnostics (outage_ts, traceroute, ping_detail, gateway, outage_type, captured_at) VALUES (?, ?, ?, ?, ?, ?)`, [ts, traceroute, pingDetail, gateway, outage_type, ts])
      inserted++
    } catch (e) {
      console.error('row error', e.message)
    }
  }
  console.log('inserted', inserted, 'diagnostics rows')
}

main().catch(e => { console.error(e); process.exit(1) })
