#!/usr/bin/env node
import { getDbPath, getDb } from '../server/db.js'
import fs from 'fs'

// Back up existing network_outages table and rebuild from audit_log events
async function main() {
  try {
    const db = getDb()
    const now = Date.now()
    const backupName = `network_outages_backup_${now}`

    console.log('Backing up existing network_outages to', backupName)
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS ${backupName} AS SELECT * FROM network_outages`) 
    } catch (e) {
      console.error('Backup failed:', e.message)
    }

    // Delete current rows
    db.exec('DELETE FROM network_outages')

    // Load audit events
    let events = db.all(`SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`)
    if (events && events.length > 0 && events[0].ts && events[0].ts < 1e12) {
      events = events.map(e => ({ ...e, ts: Number(e.ts) * 1000 }))
    }

    const outages = []
    let downTs = null
    let downType = null
    let lastUpTs = null
    let lastPayload = null

    if (!events || events.length === 0) {
      const checks = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC`)
      for (const c of checks) {
        let p = null
        try { p = JSON.parse(c.payload) } catch { p = null }
        const ok = p ? Boolean(p.ok) : false
        if (!ok && downTs === null) { downTs = c.ts; downType = p?.outage_type ?? null }
        else if (ok && downTs !== null) { outages.push({ start: downTs, end: c.ts, durationMs: c.ts - downTs, uptimeBeforeMs: lastUpTs !== null ? downTs - lastUpTs : null, outage_type: downType, ongoing: false, payload: null }); lastUpTs = c.ts; downTs = null; downType = null }
        else if (ok) { lastUpTs = c.ts }
      }
    } else {
      for (const e of events) {
        if (e.event === 'internet.down' && downTs === null) {
          downTs = e.ts
          try { const p = JSON.parse(e.payload); downType = p.outage_type ?? null; lastPayload = p } catch { downType = null; lastPayload = null }
        } else if (e.event === 'internet.up' && downTs !== null) {
          outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs: lastUpTs !== null ? downTs - lastUpTs : null, outage_type: downType, ongoing: false, payload: lastPayload })
          lastUpTs = e.ts; downTs = null; downType = null; lastPayload = null
        } else if (e.event === 'internet.up') { lastUpTs = e.ts }
      }
    }

    if (downTs !== null) outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, uptimeBeforeMs: lastUpTs !== null ? downTs - lastUpTs : null, outage_type: downType, ongoing: true, payload: lastPayload })

    console.log('Computed', outages.length, 'outages; inserting into DB...')

    const insert = db.prepare('INSERT OR REPLACE INTO network_outages (start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at) VALUES ($start,$end,$duration_ms,$uptime_before_ms,$outage_type,$ongoing,$created_at)')
    for (const o of outages) {
      let start = Number(o.start) || Date.now()
      let end = o.end == null ? null : Number(o.end)
      if (o.payload && o.payload.detected_at) {
        let det = Number(o.payload.detected_at)
        if (isFinite(det) && det > 0) {
          if (det < 1e12) det = det * 1000
          if (det <= Date.now() && Math.abs(det - start) < 1000*60*60*24) start = Math.round(det)
        }
      }
      const duration = end != null ? Math.round(Math.max(0, end - start)) : Math.round(Math.max(0, Date.now() - start))
      const uptimeBeforeMs = o.uptimeBeforeMs != null ? Number(o.uptimeBeforeMs) : null
      const type = o.outage_type ?? null
      const ongoing = o.ongoing ? 1 : 0
      insert.run({ $start: start, $end: end, $duration_ms: duration, $uptime_before_ms: uptimeBeforeMs, $outage_type: type, $ongoing: ongoing, $created_at: Date.now() })
    }

    console.log('Recompute complete.')
  } catch (e) {
    console.error('Error:', e && e.stack)
    process.exit(1)
  }
}

main()
