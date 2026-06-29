import { getDb } from '../server/db.js'
const db = getDb()
const to = Date.now()
const from = to - 7*24*60*60*1000

const totalEvents = db.get(`SELECT (SELECT COUNT(*) FROM device_events WHERE ts >= ? AND ts <= ?) + (SELECT COUNT(*) FROM audit_log WHERE ts >= ? AND ts <= ? AND event NOT IN ('service.check','config.saved')) AS n`, [from, to, from, to]).n
const outageDiagnostics = db.get(`SELECT COUNT(*) AS n FROM outage_diagnostics WHERE outage_ts >= ? AND outage_ts <= ?`, [from, to]).n
const internetChecks = db.get(`SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check'`, [from, to]).n
const downEvents = db.get(`SELECT COUNT(*) AS n FROM audit_log WHERE event = 'internet.down'`).n
const upEvents = db.get(`SELECT COUNT(*) AS n FROM audit_log WHERE event = 'internet.up'`).n
console.log({ from, to, totalEvents, outageDiagnostics, internetChecks, downEvents, upEvents })
