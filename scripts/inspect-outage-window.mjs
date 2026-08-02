import { getDb } from '../server/db.js'
const db = getDb()

const from = new Date('2026-06-27T14:28:00Z').getTime()
const to = new Date('2026-06-27T14:32:30Z').getTime()

const ev = db.all("SELECT ts,event,payload FROM audit_log WHERE event IN ('internet.down','internet.up') AND ts BETWEEN ? AND ? ORDER BY ts ASC", [from, to])
console.log('=== down/up events in window ===')
for (const e of ev) console.log(new Date(e.ts).toISOString(), e.event, e.payload)

const checks = db.all("SELECT ts,payload FROM audit_log WHERE event = 'internet.check' AND ts BETWEEN ? AND ? ORDER BY ts ASC", [from, to])
console.log('\n=== internet.check rows in window ===')
for (const c of checks) {
  let p = c.payload
  try { p = JSON.parse(c.payload) } catch (e) {}
  let out = typeof p === 'string' ? p : JSON.stringify(p)
  if (out.length > 1000) out = out.slice(0, 1000) + '...[truncated]'
  console.log(new Date(c.ts).toISOString(), out)
}
