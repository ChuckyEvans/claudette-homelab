import pkg from 'node-sqlite3-wasm'
import fs from 'fs'
const { Database } = pkg

const DB_COPY = './data/claudette.db.copy'
const OUT = './output/audit_log_full.csv'

if (!fs.existsSync(DB_COPY)) { console.error('DB copy not found at', DB_COPY); process.exit(2) }
const db = new Database(DB_COPY)

const rows = db.all('SELECT id, ts, event, actor, payload, ip FROM audit_log ORDER BY ts ASC')
if (!fs.existsSync('./output')) fs.mkdirSync('./output', { recursive: true })
const header = 'id,ts,iso_ts,event,actor,ip,payload\n'
const body = rows.map(r => {
  const iso = new Date(Number(r.ts)).toISOString()
  const payload = typeof r.payload === 'string' ? r.payload.replace(/\n/g, ' ').replace(/\r/g, '') : JSON.stringify(r.payload)
  return `${r.id},${r.ts},${iso},${r.event},${(r.actor||'').replace(/,/g,' ')} ,${(r.ip||'')},"${payload.replace(/"/g,'""')}"`
}).join('\n')
fs.writeFileSync(OUT, header + body)
console.log('Wrote', OUT, 'rows=', rows.length)
