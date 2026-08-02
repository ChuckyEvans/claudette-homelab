import { getDb } from '../server/db.js'
const db = getDb()
const vpnChecks = db.get("SELECT COUNT(*) AS n FROM audit_log WHERE event='internet.check' AND json_extract(payload,'$.vpn_up') = 1")
console.log('internet.check rows with vpn_up=true:', vpnChecks?.n ?? 0)
const vpnResults = db.get("SELECT COUNT(*) AS n FROM audit_log WHERE event='internet.check' AND json_extract(payload,'$.vpn_ok') = 1")
console.log('internet.check rows with vpn_ok=true:', vpnResults?.n ?? 0)
const speedVpn = db.get("SELECT COUNT(*) AS n FROM speedtest_results WHERE via = 'vpn'")
console.log('speedtest_results with via=vpn:', speedVpn?.n ?? 0)
// Show latest row where vpn_up=true if any
const row = db.get("SELECT ts, payload FROM audit_log WHERE event='internet.check' AND json_extract(payload,'$.vpn_up') = 1 ORDER BY ts DESC LIMIT 1")
if (row) console.log('latest vpn_up row:', new Date(row.ts).toISOString(), row.payload)
else console.log('no vpn_up rows found')
