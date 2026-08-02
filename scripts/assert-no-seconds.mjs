import { getDbPath } from '../server/db.js'
import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
import fs from 'fs'

const dbPath = getDbPath()
if (!fs.existsSync(dbPath)) {
  console.error('[assert-no-seconds] DB file not found at', dbPath)
  process.exit(1)
}
const db = new Database(dbPath)
try {
  const net = db.get('SELECT COUNT(*) as c FROM network_outages WHERE start < ?', [1e12]).c
  const tgt = db.get('SELECT COUNT(*) as c FROM target_outages WHERE start < ?', [1e12]).c
  if (net === 0 && tgt === 0) {
    console.log('[assert-no-seconds] OK — no seconds-based timestamps found')
    process.exit(0)
  }
  console.error('[assert-no-seconds] FAIL — found seconds-based rows:', { network: net, target: tgt })
  process.exit(2)
} catch (e) {
  console.error('[assert-no-seconds] ERROR', e && e.message)
  process.exit(3)
}
