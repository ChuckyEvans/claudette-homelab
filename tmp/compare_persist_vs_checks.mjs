import { getDb } from '../server/db.js'
import { loadInternetCheckRows, pairOutagesFromChecks } from '../server/lib/outages.mjs'

const db = getDb()
const to = Date.now()
const from = to - 7*24*60*60*1000

const persisted = db.all('SELECT start,end,duration_ms,uptime_before_ms,outage_type,ongoing FROM network_outages WHERE start >= ? AND start <= ? ORDER BY start ASC', [from, to])
const checks = loadInternetCheckRows(db, from, to)
const paired = pairOutagesFromChecks(checks, to)

function norm(o) {
  return { start: o.start, end: o.end ?? null, durationMs: o.durationMs ?? o.duration_ms ?? null, uptimeBeforeMs: o.uptimeBeforeMs ?? o.uptime_before_ms ?? null, outage_type: o.outage_type ?? null, ongoing: !!o.ongoing }
}

console.log('persisted:', persisted.map(norm))
console.log('paired:   ', paired.map(norm))

// Find items that differ by more than 1s in start or end
function close(a,b) { if (!a || !b) return false; return Math.abs((a||0)-(b||0)) <= 1000 }
const diffs = []
for (const p of persisted) {
  const match = paired.find(x => close(x.start, p.start) && ( (x.end==null && p.end==null) || close(x.end, p.end) ))
  if (!match) diffs.push({ persisted: norm(p), matched: null })
}
for (const q of paired) {
  const match = persisted.find(x => close(x.start, q.start) && ( (x.end==null && q.end==null) || close(x.end, q.end) ))
  if (!match) diffs.push({ persisted: null, paired: norm(q) })
}
console.log('diffs:', diffs)
