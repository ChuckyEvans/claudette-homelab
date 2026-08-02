#!/usr/bin/env node
// Backfill script: normalize persisted outage timestamps from seconds -> milliseconds
import { getDb } from '../server/db.js'

function toMs(val) {
  if (val == null) return null
  const n = Number(val)
  if (!isFinite(n)) return null
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
}

function coerceDuration(oldDurationMs, startMs, endMs) {
  // If endMs provided, prefer computing duration from start/end.
  if (endMs != null) return Math.max(0, endMs - startMs)
  // If stored duration looks like seconds (small), multiply.
  if (oldDurationMs != null) {
    const d = Number(oldDurationMs)
    if (isFinite(d)) return d < 1e12 ? Math.round(d * 1000) : Math.round(d)
  }
  return Math.max(0, Date.now() - startMs)
}

async function main() {
  const db = getDb()
  console.log('[backfill] Scanning network_outages for rows with start in seconds...')
  const rows = db.all('SELECT start,end,duration_ms,uptime_before_ms,created_at FROM network_outages WHERE start < ?', [1e12])
  console.log('[backfill] found', rows.length, 'rows to examine')
  let updated = 0
  let removed = 0
  for (const r of rows) {
    const oldStart = Number(r.start)
    const newStart = toMs(r.start)
    const newEnd = r.end == null ? null : toMs(r.end)
    const newCreated = toMs(r.created_at) ?? Date.now()
    const newUptimeBefore = r.uptime_before_ms == null ? null : toMs(r.uptime_before_ms)
    const newDuration = coerceDuration(r.duration_ms, newStart, newEnd)

    // If a row already exists with the normalized start, delete the old (seconds) row.
    const existing = db.get('SELECT start FROM network_outages WHERE start = ?', [newStart])
    if (existing) {
      console.log('[backfill] duplicate target exists for', oldStart, '->', newStart, 'deleting old row')
      db.run('DELETE FROM network_outages WHERE start = ?', [oldStart])
      removed++
      continue
    }

    // Update row in-place
    db.run('UPDATE network_outages SET start = ?, end = ?, duration_ms = ?, uptime_before_ms = ?, created_at = ? WHERE start = ?', [newStart, newEnd, newDuration, newUptimeBefore, newCreated, oldStart])
    updated++
  }

  console.log(`[backfill] network_outages: updated=${updated} removed=${removed}`)

  // Repeat for target_outages
  console.log('[backfill] Scanning target_outages for rows with start in seconds...')
  const trows = db.all('SELECT start,host,end,duration_ms,uptime_before_ms,created_at FROM target_outages WHERE start < ?', [1e12])
  console.log('[backfill] found', trows.length, 'target_outage rows')
  let tupd = 0
  let trem = 0
  for (const r of trows) {
    const oldStart = Number(r.start)
    const newStart = toMs(r.start)
    const newEnd = r.end == null ? null : toMs(r.end)
    const newCreated = toMs(r.created_at) ?? Date.now()
    const newUptimeBefore = r.uptime_before_ms == null ? null : toMs(r.uptime_before_ms)
    const newDuration = coerceDuration(r.duration_ms, newStart, newEnd)

    const existing = db.get('SELECT start FROM target_outages WHERE start = ? AND host = ?', [newStart, r.host])
    if (existing) {
      console.log('[backfill] duplicate target_outages exists for', oldStart, 'host', r.host, '-> deleting old row')
      db.run('DELETE FROM target_outages WHERE start = ? AND host = ?', [oldStart, r.host])
      trem++
      continue
    }

    db.run('UPDATE target_outages SET start = ?, end = ?, duration_ms = ?, uptime_before_ms = ?, created_at = ? WHERE start = ? AND host = ?', [newStart, newEnd, newDuration, newUptimeBefore, newCreated, oldStart, r.host])
    tupd++
  }
  console.log(`[backfill] target_outages: updated=${tupd} removed=${trem}`)

  console.log('[backfill] done')
}

main().catch(e => { console.error('[backfill] error', e && e.message); process.exit(1) })
