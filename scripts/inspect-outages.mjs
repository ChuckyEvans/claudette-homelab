#!/usr/bin/env node
// scripts/inspect-outages.mjs
// Print recent internet.* audit_log rows and compute outages (same logic as reports.js)
import fs from 'fs'
import path from 'path'
import { getDb } from '../server/db.js'
import { computeOutagesSummary } from '../server/lib/outages.mjs'

function safeParse(s){try{return JSON.parse(s)}catch(e){return null}}

(async ()=>{
  try{
    const db = getDb()

    const rows = db.all("SELECT ts,event,payload FROM audit_log WHERE event LIKE 'internet.%' ORDER BY ts DESC LIMIT 200")
    console.log('--- audit_log internet.* rows (most recent first) ---')
    console.log(JSON.stringify(rows.map(r=>({ts:r.ts,event:r.event,payload:safeParse(r.payload)})),null,2))

    const from = 0
    const to = Date.now()
    const { outages } = computeOutagesSummary(db, from, to)
    console.log('--- computed outages (newest first) ---')
    console.log(JSON.stringify(outages, null, 2))

    process.exit(0)
  }catch(e){
    console.error('inspect-outages failed:', e && e.stack || e)
    process.exit(2)
  }
})()
