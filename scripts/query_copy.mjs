import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
const { Database } = pkg

const DB_COPY = './data/claudette.db.copy'
if (!fs.existsSync(DB_COPY)) {
  console.error('DB copy not found at', DB_COPY)
  process.exit(2)
}

const db = new Database(DB_COPY)
try {
  const r = db.get("SELECT COUNT(*) AS n, MAX(ts) AS mx FROM audit_log")
  console.log('audit_log rows:', r.n)
  console.log('max_ts:', r.mx)

  const lastChecks = db.all("SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts DESC LIMIT 10")
  console.log('\n--- latest internet.check (desc) ---')
  for (const row of lastChecks) {
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
      console.log(new Date(Number(row.ts)).toISOString(), JSON.stringify(payload))
    } catch (e) {
      console.log(new Date(Number(row.ts)).toISOString(), row.payload)
    }
  }
} catch (e) {
  console.error('query failed:', e.message)
  process.exit(3)
}

process.exit(0)
