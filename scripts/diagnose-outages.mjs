import fs from 'fs'
import path from 'path'
import pkg from 'node-sqlite3-wasm'
import { getDbPath } from '../server/db.js'
import { computeOutagesSummary } from '../server/lib/outages.mjs'
const { Database } = pkg

const DB_PATH = getDbPath()
if (!fs.existsSync(DB_PATH)) {
  console.error('DB not found at', DB_PATH)
  process.exit(2)
}
const tmpPath = DB_PATH + '.diag.copy'
try { fs.copyFileSync(DB_PATH, tmpPath) } catch (e) { console.error('[error] copying DB:', e.message); process.exit(2) }
const db = new Database(tmpPath)

function q(sql, params=[]) { try { return db.get(sql, params) } catch (e) { return null } }
function qa(sql, params=[]) { try { return db.all(sql, params) } catch (e) { return [] } }

console.log('DB:', DB_PATH)
const totalChecks = q(`SELECT COUNT(*) AS n FROM audit_log WHERE event = 'internet.check'`)?.n ?? 0
console.log('internet.check rows:', totalChecks)
const minMax = q(`SELECT MIN(ts) AS minTs, MAX(ts) AS maxTs FROM audit_log WHERE event = 'internet.check'`)
console.log('minTs:', minMax?.minTs, 'maxTs:', minMax?.maxTs)
const okCounts = q(`SELECT SUM(CASE WHEN json_extract(payload,'$.ok') = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN json_extract(payload,'$.ok') = 0 THEN 1 ELSE 0 END) AS not_ok FROM audit_log WHERE event = 'internet.check'`)
console.log('ok / not_ok:', okCounts?.ok ?? 0, '/', okCounts?.not_ok ?? 0)

// Sample some recent checks
const recent = qa(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts DESC LIMIT 20`)
console.log('\nRecent internet.check rows (latest first):')
for (const r of recent) console.log(r.ts, r.payload.slice(0,200))

// Network outages table
const outagesCount = q(`SELECT COUNT(*) AS n FROM network_outages`)?.n ?? 0
console.log('\nnetwork_outages rows:', outagesCount)
const outagesSample = qa(`SELECT start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM network_outages ORDER BY start DESC LIMIT 20`)
for (const o of outagesSample) console.log(o)

// Summaries
const sumDur = q(`SELECT SUM(duration_ms) AS total_ms, AVG(duration_ms) AS avg_ms, MAX(duration_ms) AS max_ms FROM network_outages`)
console.log('\nnetwork_outages summary:', sumDur)

// Check for suspicious duration units (e.g., duration_ms < 1000 treated as seconds?)
const suspicious = q(`SELECT COUNT(*) AS n FROM network_outages WHERE duration_ms > 1000*60*60*24`)?.n ?? 0
console.log('outages with duration > 1 day (ms):', suspicious)

// Audit log anomalies: look for ts values in seconds (less than 1e12) and extreme future timestamps
const countSeconds = q(`SELECT COUNT(*) AS n FROM audit_log WHERE ts < 1000000000000`)?.n ?? 0
const countFuture = q(`SELECT COUNT(*) AS n FROM audit_log WHERE ts > ?`, [Date.now() + 1000*60*60*24])?.n ?? 0
console.log('\naudit_log rows with ts in seconds (<1e12):', countSeconds)
console.log('audit_log rows with ts in future (>now+1day):', countFuture)

console.log('\nDone')

// Compute outage summaries for a few ranges using centralized logic
try {
  const now = Date.now()
  const ranges = { '7d':[now - 7*24*60*60*1000, now], '30d':[now - 30*24*60*60*1000, now], '90d':[now - 90*24*60*60*1000, now], 'full':[0, now] }
  for (const k of Object.keys(ranges)) {
    const [from, to] = ranges[k]
    const s = computeOutagesSummary(db, from, to)
    console.log(`\nRange ${k}: outages=${s.totalOutages} downtimeMs=${s.totalDowntimeMs} longestMs=${s.longestMs}`)
  }
} catch (e) {
  console.error('computeOutagesSummary failed:', e && e.stack || e)
}
