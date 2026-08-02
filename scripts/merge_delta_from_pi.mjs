import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
import { copyFileSync } from 'fs'
const { Database } = pkg

const TARGET = process.argv[2] || './data/claudette.db.copy'
const PI = process.argv[3] || './data/pi-claudette.db.copy'
const OUT = process.argv[4] || './data/claudette.db.merged_delta'

if (!fs.existsSync(TARGET)) { console.error('Target DB missing:', TARGET); process.exit(2) }
if (!fs.existsSync(PI))     { console.error('Pi DB missing:', PI); process.exit(2) }

try {
  copyFileSync(TARGET, OUT)
  console.log('Copied', TARGET, 'to', OUT)
} catch (e) {
  console.error('failed to copy target DB:', e.message); process.exit(3)
}

const outDb = new Database(OUT)
const piDb = new Database(PI)

try {
  const piRows = piDb.all('SELECT ts,event,actor,payload,ip FROM audit_log ORDER BY ts ASC')
  console.log('pi audit_log rows to consider:', piRows.length)
  let inserted = 0
  let skipped = 0
  for (const r of piRows) {
    const ts = Number(r.ts)
    const event = r.event || ''
    const payload = r.payload == null ? '{}' : r.payload
    const exists = outDb.get('SELECT 1 FROM audit_log WHERE ts = ? AND event = ? AND payload = ? LIMIT 1', [ts, event, payload])
    if (exists) { skipped++; continue }
    try {
      outDb.run('INSERT INTO audit_log (ts,event,actor,payload,ip) VALUES (?, ?, ?, ?, ?)', [ts, event, r.actor || 'system', payload, r.ip || null])
      inserted++
    } catch (e) {
      // if the insert fails for other reasons, log and continue
      console.warn('insert failed for ts', ts, 'event', event, ':', e.message)
    }
  }
  console.log('Inserted rows into merged delta DB:', inserted)
  console.log('Skipped existing rows:', skipped)
} catch (e) {
  console.error('merge failed:', e.message)
  process.exit(4)
}

process.exit(0)
