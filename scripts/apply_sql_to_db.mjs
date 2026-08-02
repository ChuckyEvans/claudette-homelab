import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
const { Database } = pkg

const DB = process.argv[2] || './data/claudette.db.copy'
const SQL = process.argv[3] || './output/audit_log_delta.sql'

if (!fs.existsSync(DB)) { console.error('DB missing:', DB); process.exit(2) }
if (!fs.existsSync(SQL)) { console.error('SQL file missing:', SQL); process.exit(2) }

const sql = fs.readFileSync(SQL, 'utf8')
try {
  const db = new Database(DB)
  db.exec(sql)
  console.log('Applied SQL to', DB)
} catch (e) {
  console.error('apply failed:', e && e.message)
  process.exit(3)
}

process.exit(0)
