import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
const { Database } = pkg

const MAIN_COPY = './data/claudette.db.copy'
const PI_COPY = './data/pi-claudette.db.copy'
if (!fs.existsSync(MAIN_COPY)) { console.error('Main DB copy missing:', MAIN_COPY); process.exit(2) }
if (!fs.existsSync(PI_COPY))   { console.error('Pi DB copy missing:', PI_COPY); process.exit(2) }

const main = new Database(MAIN_COPY)
const pi = new Database(PI_COPY)

try {
  const mxRow = main.get('SELECT MAX(ts) AS mx FROM audit_log')
  const mainMx = mxRow?.mx ? Number(mxRow.mx) : 0
  console.log('main max ts:', mainMx)
  const newRows = pi.all('SELECT ts,event,actor,payload,ip FROM audit_log WHERE ts > ? ORDER BY ts ASC', [mainMx])
  console.log('rows to import from pi:', newRows.length)
  let inserted = 0
  for (const r of newRows) {
    try {
      main.run('INSERT INTO audit_log (ts,event,actor,payload,ip) VALUES (?, ?, ?, ?, ?)', [Number(r.ts), r.event, r.actor || 'system', r.payload || '{}', r.ip || null])
      inserted++
    } catch (e) {
      // ignore duplicate/constraint errors
    }
  }
  console.log('Inserted rows into main copy:', inserted)
  // Write out merged DB copy for safety
  const mergedPath = './data/claudette.db.merged'
  fs.copyFileSync(MAIN_COPY, mergedPath)
  console.log('Wrote merged DB copy to', mergedPath)
} catch (e) {
  console.error('merge failed:', e.message)
  process.exit(3)
}

process.exit(0)
