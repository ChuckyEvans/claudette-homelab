import { getDb } from '../db.js'

async function run() {
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS ip_history (ip TEXT, mac TEXT, ts INTEGER);
    CREATE INDEX IF NOT EXISTS idx_ip_hist_ip ON ip_history (ip);
    CREATE INDEX IF NOT EXISTS idx_ip_hist_mac ON ip_history (mac);`)
  const now = Date.now()
  // Seed from current devices snapshot without deleting anything
  db.run('INSERT INTO ip_history (ip,mac,ts) SELECT ip,mac,? FROM devices WHERE ip IS NOT NULL AND mac IS NOT NULL', [now])
  const count = db.get('SELECT COUNT(*) as c FROM ip_history')?.c ?? 0
  console.log('ip_history ensured and seeded rows=', count)
}

run().catch(e=>{console.error('failed:', e && e.message); process.exit(1)})
