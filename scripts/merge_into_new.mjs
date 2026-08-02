import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
import { copyFileSync } from 'fs'
const { Database } = pkg

const MAIN_COPY = './data/claudette.db.copy'
const PI_COPY = './data/pi-claudette.db.copy'
const MERGED = './data/claudette.db.merged2'

if (!fs.existsSync(MAIN_COPY)) { console.error('Main DB copy missing:', MAIN_COPY); process.exit(2) }
if (!fs.existsSync(PI_COPY))   { console.error('Pi DB copy missing:', PI_COPY); process.exit(2) }

try {
  // Copy main to merged target (overwrite)
  copyFileSync(MAIN_COPY, MERGED)
  console.log('Copied', MAIN_COPY, 'to', MERGED)
} catch (e) {
  console.error('failed to copy main DB:', e.message); process.exit(3)
}

const merged = new Database(MERGED)
const pi = new Database(PI_COPY)

try {
  const mxRow = merged.get('SELECT MAX(ts) AS mx FROM audit_log')
  const mergedMx = mxRow?.mx ? Number(mxRow.mx) : 0
  console.log('merged max ts:', mergedMx)
  const newRows = pi.all('SELECT ts,event,actor,payload,ip FROM audit_log WHERE ts > ? ORDER BY ts ASC', [mergedMx])
  console.log('rows to import from pi:', newRows.length)
  let inserted = 0
  for (const r of newRows) {
    try {
      merged.run('INSERT INTO audit_log (ts,event,actor,payload,ip) VALUES (?, ?, ?, ?, ?)', [Number(r.ts), r.event, r.actor || 'system', r.payload || '{}', r.ip || null])
      inserted++
    } catch (e) {
      // ignore duplicates/constraint errors
    }
  }
  console.log('Inserted rows into merged DB:', inserted)
} catch (e) {
  console.error('merge failed:', e.message)
  process.exit(4)
}

process.exit(0)
