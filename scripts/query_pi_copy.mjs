import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
const { Database } = pkg

const DB_COPY = './data/pi-claudette.db.copy'
if (!fs.existsSync(DB_COPY)) { console.error('DB copy not found at', DB_COPY); process.exit(2) }
const db = new Database(DB_COPY)
try {
  const r = db.get("SELECT COUNT(*) AS n, MAX(ts) AS mx FROM audit_log")
  console.log('pi audit_log rows:', r.n)
  console.log('pi max_ts:', r.mx)
  const last = db.all("SELECT ts, event, payload FROM audit_log ORDER BY ts DESC LIMIT 5")
  console.log('\n--- latest 5 rows ---')
  for (const row of last) console.log(new Date(Number(row.ts)).toISOString(), row.event)
} catch (e) { console.error('query failed:', e.message); process.exit(3) }
process.exit(0)
