import { getDbPath } from '../server/db.js'
import fs from 'fs'
import path from 'path'
import pkg from 'node-sqlite3-wasm'
const { Database } = pkg

const DB_PATH = getDbPath()
if (!fs.existsSync(DB_PATH)) {
  console.error('DB not found at', DB_PATH)
  process.exit(2)
}
// Copy DB to temp path to avoid locks from a running server process
const tmpPath = DB_PATH + '.copy'
try { fs.copyFileSync(DB_PATH, tmpPath) } catch (e) { console.error('[error] copying DB:', e.message); process.exit(2) }
const db = new Database(tmpPath)

function computeOutages(db, from, to) {
  let events = db.all(
    `SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`
  )
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
  if (downTs !== null) {
    const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
    outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, uptimeBeforeMs, outage_type: downType, ongoing: true })
  }
  const windowed = outages.filter(o => (!o.end || o.end >= from) && o.start <= to).reverse()
  return windowed
}

const to = Date.now()
const from = to - (7 * 24 * 60 * 60 * 1000)
const rows = computeOutages(db, from, to)
const outDir = path.join(process.cwd(), 'output')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `outages_${new Date().toISOString().slice(0,10)}.csv`)
const header = 'start,end,duration_ms,uptime_before_ms,outage_type,ongoing\n'
const body = rows.map(o => `${o.start},${o.end ?? ''},${o.durationMs},${o.uptimeBeforeMs ?? ''},${o.outage_type ?? ''},${o.ongoing ? '1' : '0'}`).join('\n')
fs.writeFileSync(outPath, header + body)
console.log('Wrote', outPath)
