import fs from 'fs'
import path from 'path'
import { getDb } from '../server/db.js'

function normalizeHostString(s) {
  if (!s || typeof s !== 'string') return ''
  try {
    let t = s.trim()
    t = t.replace(/^https?:\/\//i, '')
    t = t.replace(/\/$/, '')
    t = t.replace(/:\d+$/, '')
    return t.toLowerCase()
  } catch { return s }
}

const db = getDb()
console.log('[aggregate] scanning audit_log for internet.check rows')
const rows = db.all("SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC")
if (!rows || rows.length === 0) { console.log('no internet.check rows found'); process.exit(0) }
if (rows[0].ts && rows[0].ts < 1e12) rows.forEach(r => r.ts = Number(r.ts) * 1000)

const stats = new Map()
for (const r of rows) {
  let p = null
  try { p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload } catch { p = null }
  const results = Array.isArray(p?.results) ? p.results : []
  for (const res of results) {
    const rawHost = res.host || res.url || ''
    const host = normalizeHostString(rawHost)
    if (!host) continue
    const ok = !!res.ok
    const ts = res.ts ? Number(res.ts) : (r.ts || Date.now())
    let entry = stats.get(host)
    if (!entry) { entry = { host, checks:0, ok:0, fail:0, firstTs:ts, lastTs:ts }; stats.set(host, entry) }
    entry.checks += 1
    if (ok) entry.ok += 1; else entry.fail += 1
    if (ts && ts < entry.firstTs) entry.firstTs = ts
    if (ts && ts > entry.lastTs) entry.lastTs = ts
  }
}

const outRows = Array.from(stats.values()).sort((a,b) => b.fail - a.fail || b.checks - a.checks)
console.log('[aggregate] hosts found:', outRows.length)
const outPath = path.join('output', 'checks_summary.csv')
if (!fs.existsSync('output')) fs.mkdirSync('output', { recursive: true })
const csv = ['host,checks,ok,fail,first_ts_iso,last_ts_iso']
for (const r of outRows) {
  csv.push([r.host, r.checks, r.ok, r.fail, new Date(r.firstTs).toISOString(), new Date(r.lastTs).toISOString()].map(v => String(v).replace(/\"/g,'"')).join(','))
}
fs.writeFileSync(outPath, csv.join('\n'))
console.log('[aggregate] CSV written to', outPath)
console.log('\nTop 20 hosts by failures:')
for (let i=0;i<Math.min(20,outRows.length);i++) {
  const r = outRows[i]
  console.log(`${i+1}. ${r.host} — checks=${r.checks} fail=${r.fail} ok=${r.ok} first=${new Date(r.firstTs).toISOString()} last=${new Date(r.lastTs).toISOString()}`)
}
