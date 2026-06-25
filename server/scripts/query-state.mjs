import { getDb } from '../db.js'

async function run(){
  const db = getDb()
  const alerts = db.all('SELECT id, type, key, payload, first_seen, last_seen, count FROM alerts ORDER BY last_seen DESC LIMIT 50')
  const ih = db.all('SELECT ip, mac, ts FROM ip_history ORDER BY ts DESC LIMIT 50')
  const devices = db.all('SELECT mac, ip, hostname FROM devices ORDER BY last_seen DESC LIMIT 50')
  console.log(JSON.stringify({alerts: alerts||[], ip_history: ih||[], devices: devices||[]}, null, 2))
}

run().catch(e=>{console.error('err', e && e.message); process.exit(1)})
