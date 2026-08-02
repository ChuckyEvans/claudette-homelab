import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
import fs from 'fs'
const DB = 'C:/Development/Claudette/data/pi-claudette.db'
if (!fs.existsSync(DB)) { console.error('DB not found at', DB); process.exit(2) }
const db = new Database(DB)

function parseInternetCheckRow(row) {
  try {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    return { ts: Number(row.ts), ok: Boolean(payload.ok), outage_type: payload.outage_type ?? null, payload }
  } catch { return null }
}

function loadInternetCheckRows(db, from, to) {
  const rows = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' AND ts >= ? AND ts <= ? ORDER BY ts ASC`, [from, to])
  const previous = db.get(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' AND ts < ? ORDER BY ts DESC LIMIT 1`, [from])
  const all = [previous, ...rows].filter(Boolean).map(parseInternetCheckRow).filter(Boolean)
  if (all.length > 0 && all[0].ts && all[0].ts < 1e12) for (const r of all) r.ts = Number(r.ts) * 1000
  return all
}

function pairOutagesFromChecks(checks, nowMs = Date.now()) {
  const outages = []
  let downTs = null, downType = null, lastUpTs = null
  for (const row of checks) {
    if (!row.ok && downTs === null) { downTs = row.ts; downType = row.outage_type ?? null }
    else if (row.ok && downTs !== null) { const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null; outages.push({ start: downTs, end: row.ts, durationMs: row.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false }); lastUpTs = row.ts; downTs = null; downType = null }
    else if (row.ok) lastUpTs = row.ts
  }
  if (downTs !== null) { const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null; outages.push({ start: downTs, end: null, durationMs: nowMs - downTs, uptimeBeforeMs, outage_type: downType, ongoing: true }) }
  return outages
}

function computeOutages(db, from, to) {
  const checks = loadInternetCheckRows(db, from, to)
  let outages = []
  let usedPersistedRows = false
  try {
    const persisted = db.all(`SELECT start, end, duration_ms, outage_type, ongoing, created_at FROM network_outages WHERE start <= ? ORDER BY start ASC`, [to])
    if (persisted && persisted.length > 0) {
      usedPersistedRows = true
      let lastEnd = null
      for (const row of persisted) {
        const start = Number(row.start)
        const end = row.end == null ? null : Number(row.end)
        const durationMs = Number(row.duration_ms ?? (end != null ? end - start : Date.now() - start))
        const uptimeBeforeMs = lastEnd !== null ? start - lastEnd : null
        if ((end == null || end >= from) && start <= to) outages.push({ start, end, durationMs, uptimeBeforeMs, outage_type: row.outage_type ?? null, ongoing: Number(row.ongoing) === 1 })
        lastEnd = end ?? start + durationMs
      }
    }
  } catch (e) { usedPersistedRows = false }

  if (!usedPersistedRows) {
    let events = []
    try { events = db.all(`SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`) } catch (e) { events = [] }
    if (events && events.length > 0 && events[0].ts && events[0].ts < 1e12) events = events.map(e => ({ ...e, ts: Number(e.ts) * 1000 }))

    let downTs = null, downType = null, lastUpTs = null
    if (!events || events.length === 0) {
      const checksAll = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC`)
      for (const c of checksAll) {
        let p = null
        try { p = JSON.parse(c.payload) } catch { p = null }
        const ok = p ? Boolean(p.ok) : false
        if (!ok && downTs === null) { downTs = c.ts; downType = p?.outage_type ?? null }
        else if (ok && downTs !== null) { const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null; outages.push({ start: downTs, end: c.ts, durationMs: c.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false }); lastUpTs = c.ts; downTs = null; downType = null }
        else if (ok) lastUpTs = c.ts
      }
    } else {
      for (const e of events) {
        if (e.event === 'internet.down' && downTs === null) { downTs = e.ts; try { const p = JSON.parse(e.payload); downType = p.outage_type ?? null } catch { downType = null } }
        else if (e.event === 'internet.up' && downTs !== null) { const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null; outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false }); lastUpTs = e.ts; downTs = null; downType = null }
        else if (e.event === 'internet.up') lastUpTs = e.ts
      }
    }
    if (downTs !== null) outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, uptimeBeforeMs: lastUpTs !== null ? downTs - lastUpTs : null, outage_type: downType, ongoing: true })
  }

  if (checks.length > 0) {
    outages = pairOutagesFromChecks(checks)
    // Keep the paired check timestamps as the outage boundaries.
  }

  const nowMs = Date.now()
  const clipped = outages
    .map(o => {
      const origStart = o.start
      const origEnd = o.end
      const clippedStart = Math.max(origStart, from)
      const clippedEndRaw = origEnd != null ? Math.min(origEnd, to) : (o.ongoing ? Math.min(nowMs, to) : null)
      const clippedEnd = clippedEndRaw != null && clippedEndRaw >= clippedStart ? clippedEndRaw : (clippedEndRaw != null ? clippedEndRaw : null)
      const durationMs = clippedEnd != null ? (clippedEnd - clippedStart) : (o.ongoing ? Math.max(0, nowMs - clippedStart) : 0)
      let uptimeBeforeMs = o.uptimeBeforeMs
      if (uptimeBeforeMs != null) {
        const lastUpTs = origStart - uptimeBeforeMs
        if (lastUpTs < from) uptimeBeforeMs = Math.max(0, origStart - from)
      }
      return { ...o, start: clippedStart, end: clippedEnd, durationMs, uptimeBeforeMs }
    })
    .filter(o => (!o.end || o.end >= from) && o.start <= to)
    .reverse()

  return clipped
}

function computeOutagesSummary(db, from, to) {
  const outages = computeOutages(db, from, to)
  const totalDowntimeMs = outages.reduce((s, o) => s + (o.durationMs || 0), 0)
  const longestMs = outages.length ? Math.max(...outages.map(o => o.durationMs || 0)) : 0
  return { outages, totalDowntimeMs, longestMs, totalOutages: outages.length }
}

// run for 2026-07-17 -> 2026-07-20
const from = Date.parse('2026-07-17T00:00:00Z')
const to = Date.parse('2026-07-20T23:59:59Z')
const summary = computeOutagesSummary(db, from, to)
console.log(JSON.stringify({ from, to, isoFrom: new Date(from).toISOString(), isoTo: new Date(to).toISOString(), summary }, null, 2))
