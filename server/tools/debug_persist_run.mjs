import { getDb } from '../db.js'
import * as dbmod from '../db.js'
import * as outages from '../lib/outages.mjs'
import { persistOutages } from '../db.js'
(async ()=>{
  const db = getDb()
  console.log('[debug] computing pairedFromChecks across full history')
  const checks = outages.loadInternetCheckRows(db, 0, Date.now())
  const paired = outages.pairOutagesFromChecks(checks)
  console.log('[debug] paired count', paired.length)
  console.log(JSON.stringify(paired.slice(-10), null, 2))
  console.log('[debug] calling persistOutages() now')
  const n = persistOutages()
  console.log('[debug] persistOutages returned', n)
  const rows = db.all('SELECT start,end,duration_ms,outage_type,ongoing,created_at FROM network_outages ORDER BY start ASC')
  console.log('[debug] persisted rows count', rows.length)
  for (const r of rows) console.log(new Date(r.start).toISOString(), '->', r.end?new Date(r.end).toISOString():null, 'type', r.outage_type)
})().catch(e=>{ console.error(e&&e.stack||e); process.exit(1) })
