import { getDb } from '../db.js'
(async ()=>{
  const db = getDb()
  const rows = db.all("SELECT ts,payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts DESC LIMIT 10")
  for (const r of rows) {
    let ts = Number(r.ts)
    if (ts && ts < 1e12) ts = ts * 1000
    const p = (() => { try { return typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload } catch { return null } })()
    console.log(new Date(ts).toISOString(), 'ok=', p?.ok, 'resultsCount=', Array.isArray(p?.results)?p.results.length:0)
    if (p && p.results) {
      for (const res of p.results.slice(0,5)) {
        let rts = res.ts ? Number(res.ts) : ts
        if (rts && rts < 1e12) rts = rts * 1000
        console.log('   ', res.host || res.url, 'ok=', res.ok, 'ts=', new Date(rts).toISOString())
      }
    }
    console.log('---')
  }
})().catch(e=>{ console.error(e && e.stack); process.exit(1) })
