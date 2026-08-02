import { getDbPath } from '../server/db.js'
import fs from 'fs'
import path from 'path'
import pkg from 'node-sqlite3-wasm'
import { computeOutages } from '../server/lib/outages.mjs'
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
