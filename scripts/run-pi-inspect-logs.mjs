import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
import fs from 'fs'
const DB = 'C:/Development/Claudette/data/pi-claudette.db'
if (!fs.existsSync(DB)) { console.error('DB not found at', DB); process.exit(2) }
const db = new Database(DB)
const from = Date.parse('2026-07-17T00:00:00Z')
const to = Date.parse('2026-07-20T23:59:59Z')

console.log('Range:', new Date(from).toISOString(), new Date(to).toISOString())
const totalChecks = db.get("SELECT COUNT(*) as n FROM audit_log WHERE event='internet.check' AND ts BETWEEN ? AND ?", [from, to]).n
const downCount = db.get("SELECT COUNT(*) as n FROM audit_log WHERE event='internet.down' AND ts BETWEEN ? AND ?", [from, to]).n
const upCount = db.get("SELECT COUNT(*) as n FROM audit_log WHERE event='internet.up' AND ts BETWEEN ? AND ?", [from, to]).n
console.log('internet.check:', totalChecks, 'internet.down:', downCount, 'internet.up:', upCount)

console.log('\n--- Sample internet.check rows (not-ok) ---')
const badChecks = db.all("SELECT ts, payload FROM audit_log WHERE event='internet.check' AND ts BETWEEN ? AND ? AND json_extract(payload,'$.ok') = 0 ORDER BY ts ASC", [from, to])
for (const r of badChecks.slice(0,50)) console.log(new Date(r.ts).toISOString(), r.payload)

console.log('\n--- internet.down/up events in range ---')
const events = db.all("SELECT ts,event,payload FROM audit_log WHERE event IN ('internet.down','internet.up') AND ts BETWEEN ? AND ? ORDER BY ts ASC", [from, to])
for (const e of events) console.log(new Date(e.ts).toISOString(), e.event, e.payload)

console.log('\n--- network_outages in window ---')
const outages = db.all('SELECT start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM network_outages WHERE (start BETWEEN ? AND ?) OR (end BETWEEN ? AND ?) OR (start <= ? AND (end IS NULL OR end >= ?)) ORDER BY start ASC', [from, to, from, to, from, to])
for (const o of outages) console.log(new Date(o.start).toISOString(), o.end ? new Date(o.end).toISOString() : null, o.duration_ms, o.outage_type, o.ongoing)

console.log('\n--- outage_diagnostics in window ---')
const diags = db.all('SELECT outage_ts,captured_at,outage_type,gateway FROM outage_diagnostics WHERE captured_at BETWEEN ? AND ? ORDER BY captured_at ASC', [from, to])
for (const d of diags) console.log(new Date(d.captured_at).toISOString(), new Date(d.outage_ts).toISOString(), d.outage_type, d.gateway)

console.log('\nDone')
