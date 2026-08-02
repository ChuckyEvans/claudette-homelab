import { getDb } from '../server/db.js'
const db = getDb()
const rows = db.all('SELECT ts, via, download_mbps, upload_mbps, ping_ms FROM speedtest_results ORDER BY ts DESC LIMIT 20')
for (const r of rows) console.log(new Date(r.ts).toISOString(), r.via, r.download_mbps, r.upload_mbps, r.ping_ms)
console.log('total:', rows.length)
