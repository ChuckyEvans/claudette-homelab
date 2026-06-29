import { getDb } from '../server/db.js'
const db = getDb()
console.log('outage_diagnostics:', db.get('SELECT COUNT(*) AS n FROM outage_diagnostics').n)
console.log('evidence_files:', db.get('SELECT COUNT(*) AS n FROM evidence_files').n)
console.log('internet.down count:', db.get("SELECT COUNT(*) AS n FROM audit_log WHERE event='internet.down'").n)
console.log('internet.up count:', db.get("SELECT COUNT(*) AS n FROM audit_log WHERE event='internet.up'").n)
const checks = db.all("SELECT ts, payload FROM audit_log WHERE event='internet.check' ORDER BY ts DESC LIMIT 10")
console.log('\n--- latest internet.check rows ---')
for (const r of checks) console.log(new Date(r.ts).toISOString(), r.payload)
