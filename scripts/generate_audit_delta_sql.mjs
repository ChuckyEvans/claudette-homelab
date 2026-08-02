import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
import { copyFileSync } from 'fs'
const { Database } = pkg

const TARGET = process.argv[2] || './data/claudette.db.copy'
const PI = process.argv[3] || './data/pi-claudette.db.copy'
const OUTSQL = process.argv[4] || './output/audit_log_delta.sql'

if (!fs.existsSync(TARGET)) { console.error('Target DB missing:', TARGET); process.exit(2) }
if (!fs.existsSync(PI))     { console.error('Pi DB missing:', PI); process.exit(2) }

const t = new Database(TARGET)
const p = new Database(PI)

try {
  const piRows = p.all('SELECT ts,event,actor,payload,ip FROM audit_log ORDER BY ts ASC')
  console.log('pi rows:', piRows.length)
  // We'll emit INSERT OR IGNORE to avoid duplicates (assumes no PK on audit_log)
  const lines = []
  lines.push('-- audit_log delta generated from pi DB')
  lines.push('BEGIN TRANSACTION;')
  for (const r of piRows) {
    const ts = Number(r.ts)
    const event = (r.event || '').replace(/'/g, "''")
    const actor = (r.actor || 'system').replace(/'/g, "''")
    const payload = (r.payload == null ? '{}' : r.payload).replace(/'/g, "''")
    const ip = r.ip == null ? 'NULL' : `'${String(r.ip).replace(/'/g, "''")}'`
    // Heuristic: only include rows that don't already exist by exact match
    const exists = t.get('SELECT 1 FROM audit_log WHERE ts = ? AND event = ? AND payload = ? LIMIT 1', [ts, r.event, r.payload])
    if (exists) continue
    lines.push(`INSERT INTO audit_log (ts,event,actor,payload,ip) VALUES (${ts}, '${event}', '${actor}', '${payload}', ${ip});`)
  }
  lines.push('COMMIT;')

  fs.writeFileSync(OUTSQL, lines.join('\n') + '\n', 'utf8')
  console.log('Wrote delta SQL to', OUTSQL)
} catch (e) {
  console.error('failed to generate delta SQL:', e && e.message)
  process.exit(3)
}

process.exit(0)
