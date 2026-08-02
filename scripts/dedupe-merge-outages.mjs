#!/usr/bin/env node
import fs from 'fs'

async function main() {
  try {
    let dbModule
    try { dbModule = await import('/app/server/db.js') } catch { dbModule = await import('../server/db.js') }
    const db = dbModule.getDb()

    console.log('Loading network_outages rows...')
    let rows = db.all('SELECT start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM network_outages ORDER BY start ASC')
    rows = rows.map(r => ({
      start: r.start == null ? null : Number(r.start),
      end: r.end == null ? null : Number(r.end),
      duration_ms: r.duration_ms == null ? null : Number(r.duration_ms),
      uptime_before_ms: r.uptime_before_ms == null ? null : Number(r.uptime_before_ms),
      outage_type: r.outage_type ?? null,
      ongoing: Number(r.ongoing) === 1,
      created_at: r.created_at == null ? Date.now() : Number(r.created_at)
    }))

    if (!rows || rows.length === 0) {
      console.log('No rows to process; exiting.')
      return
    }

    const merged = []
    let cur = { ...rows[0] }

    function maxNullable(a, b) {
      if (a == null) return b
      if (b == null) return a
      return Math.max(a, b)
    }

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      const curEnd = cur.end == null ? Infinity : cur.end
      const rEnd = r.end == null ? Infinity : r.end
      // Consider overlapping if r.start <= curEnd
      if (r.start <= curEnd) {
        // merge into cur
        cur.start = Math.min(cur.start, r.start)
        cur.end = (curEnd === Infinity || rEnd === Infinity) ? null : Math.max(cur.end || 0, r.end || 0)
        cur.duration_ms = cur.end != null ? Math.max(0, cur.end - cur.start) : null
        cur.uptime_before_ms = cur.uptime_before_ms != null ? cur.uptime_before_ms : r.uptime_before_ms
        cur.outage_type = cur.outage_type ?? r.outage_type
        cur.ongoing = cur.ongoing || r.ongoing
        cur.created_at = Math.min(cur.created_at || Date.now(), r.created_at || Date.now())
      } else {
        // no overlap, push cur and start new
        merged.push(cur)
        cur = { ...r }
      }
    }
    merged.push(cur)

    console.log('Merged rows count:', merged.length, '(original', rows.length, ')')

    // Backup current table
    const now = Date.now()
    const backupName = `network_outages_dedupe_backup_${now}`
    try {
      console.log('Backing up network_outages to', backupName)
      db.exec(`CREATE TABLE IF NOT EXISTS ${backupName} AS SELECT * FROM network_outages`)
    } catch (e) {
      console.error('Backup failed:', e.message)
    }

    // Replace table contents with merged rows
    try {
      db.exec('DELETE FROM network_outages')
      const insert = db.prepare('INSERT OR REPLACE INTO network_outages (start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at) VALUES ($start,$end,$duration_ms,$uptime_before_ms,$outage_type,$ongoing,$created_at)')
      for (const m of merged) {
        const start = Number(m.start)
        const end = m.end == null ? null : Number(m.end)
        const duration = end != null ? Math.round(Math.max(0, end - start)) : (m.ongoing ? Math.round(Math.max(0, Date.now() - start)) : null)
        insert.run({ $start: start, $end: end, $duration_ms: duration, $uptime_before_ms: m.uptime_before_ms, $outage_type: m.outage_type, $ongoing: m.ongoing ? 1 : 0, $created_at: m.created_at })
      }
      console.log('Replaced network_outages with merged rows.')
    } catch (e) {
      console.error('Failed to write merged rows:', e.message)
      process.exit(1)
    }

    console.log('Dedupe/merge complete.')
  } catch (e) {
    console.error('Error:', e && e.stack)
    process.exit(1)
  }
}

main()
