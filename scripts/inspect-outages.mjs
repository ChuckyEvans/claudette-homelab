#!/usr/bin/env node
// scripts/inspect-outages.mjs
// Print recent internet.* audit_log rows and compute outages (same logic as reports.js)
import fs from 'fs'
import path from 'path'

function safeParse(s){try{return JSON.parse(s)}catch(e){return null}}

(async ()=>{
  try{
    const dbmod = await import('/app/server/db.js')
    const db = dbmod.getDb()

    const rows = db.all("SELECT ts,event,payload FROM audit_log WHERE event LIKE 'internet.%' ORDER BY ts DESC LIMIT 200")
    console.log('--- audit_log internet.* rows (most recent first) ---')
    console.log(JSON.stringify(rows.map(r=>({ts:r.ts,event:r.event,payload:safeParse(r.payload)})),null,2))

    // Reimplement computeOutages here to show pairing details
    const events = db.all(`SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`)
    let evs = events
    if (evs && evs.length > 0 && evs[0].ts && evs[0].ts < 1e12) {
      evs = evs.map(e => ({ ...e, ts: Number(e.ts) * 1000 }))
    }

    const outages = []
    let downTs = null
    let downType = null
    let lastUpTs = null

    if (!evs || evs.length === 0) {
      const checks = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC`)
      for (const c of checks) {
        const p = safeParse(c.payload)
        const ok = p ? Boolean(p.ok) : false
        if (!ok && downTs === null) { downTs = c.ts; downType = p?.outage_type ?? null }
        else if (ok && downTs !== null) {
          const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
          outages.push({ start: downTs, end: c.ts, durationMs: c.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
          lastUpTs = c.ts; downTs = null; downType = null
        } else if (ok) { lastUpTs = c.ts }
      }
    } else {
      for (const e of evs) {
        if (e.event === 'internet.down' && downTs === null) {
          downTs = e.ts
          try { const p = safeParse(e.payload); downType = p?.outage_type ?? null } catch { downType = null }
        } else if (e.event === 'internet.up' && downTs !== null) {
          const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
          outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
          lastUpTs = e.ts; downTs = null; downType = null
        } else if (e.event === 'internet.up') {
          lastUpTs = e.ts
        }
      }
    }
    if (downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, uptimeBeforeMs, outage_type: downType, ongoing: true })
    }

    console.log('--- computed outages (newest first) ---')
    console.log(JSON.stringify(outages.slice().reverse(),null,2))

    process.exit(0)
  }catch(e){
    console.error('inspect-outages failed:', e && e.stack || e)
    process.exit(2)
  }
})()
