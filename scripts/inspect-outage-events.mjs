import { getDb } from '../server/db.js'
const db = getDb()

const events = db.all("SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts DESC LIMIT 10")
console.log('=== recent internet.down/up events ===')
for (const e of events) {
  console.log(new Date(e.ts).toISOString(), e.event, e.payload)
}

if (events.length > 0) {
  const firstTs = events[events.length-1].ts
  const from = firstTs - (10 * 60 * 1000)
  const to = events[0].ts + (10 * 60 * 1000)
    const checks = db.all("SELECT ts, payload FROM audit_log WHERE event = 'internet.check' AND ts BETWEEN ? AND ? ORDER BY ts ASC", [from, to])
    console.log('\n=== internet.check rows around events (10min each side) ===')
    for (const c of checks) {
      let p = c.payload
      try { p = JSON.parse(c.payload) } catch (e) { /* leave as-is */ }
      let out = typeof p === 'string' ? p : JSON.stringify(p)
      if (out.length > 1000) out = out.slice(0, 1000) + '...[truncated]'
      console.log(new Date(c.ts).toISOString(), out)
    }
} else {
  console.log('No internet.down/up events found')
}
