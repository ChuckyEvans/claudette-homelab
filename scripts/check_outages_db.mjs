import { getDb } from '../server/db.js'

const db = getDb()
const counts = {}
counts.device_events = db.get('SELECT COUNT(*) AS n FROM device_events').n
counts.audit_internet_check = db.get("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'internet.check'").n
counts.audit_down = db.get("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'internet.down'").n
counts.audit_up = db.get("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'internet.up'").n
counts.outage_diags = db.get('SELECT COUNT(*) AS n FROM outage_diagnostics').n
console.log(JSON.stringify(counts, null, 2))
