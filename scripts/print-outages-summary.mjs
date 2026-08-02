#!/usr/bin/env node
import fs from 'fs'
(async function(){
  try {
    let outagesMod, dbMod
    try { outagesMod = await import('/app/server/lib/outages.mjs'); dbMod = await import('/app/server/db.js') } catch (e) { outagesMod = await import('../server/lib/outages.mjs'); dbMod = await import('../server/db.js') }
    const db = dbMod.getDb()
    const from = Date.parse('2026-07-17T00:00:00Z')
    const to = Date.parse('2026-07-20T23:59:59Z')
    const summary = outagesMod.computeOutagesSummary(db, from, to)
    const firstEv = db.get(`SELECT MIN(ts) AS ts FROM audit_log WHERE event IN ('internet.check','internet.down','internet.up')`)
    let allFrom = firstEv && firstEv.ts ? Number(firstEv.ts) : null
    if (allFrom && allFrom < 1e12) allFrom = allFrom * 1000
    const allSummary = allFrom ? outagesMod.computeOutagesSummary(db, allFrom, Date.now()) : null
    console.log(JSON.stringify({ range: { from, to, isoFrom: new Date(from).toISOString(), isoTo: new Date(to).toISOString() }, summary, allSummary }, null, 2))
  } catch (e) {
    console.error(e && e.stack)
    process.exit(1)
  }
})()
