import fs from 'fs'
import path from 'path'

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

try{
  // Ensure DB reset to clear locks
  const dbInit = await import('../db.js')
  dbInit.resetDb()
  // Re-import DB module to get fresh handles
  const db = await import('../db.js')

  console.log('[run_full_backfill] starting backfill loop')
  let totalTarget = 0
  let totalNetwork = 0
  for (let pass=1; pass<=8; pass++){
    try{
      console.log('[run_full_backfill] pass', pass)
      const wroteT = await db.persistTargetOutages()
      const wroteN = await db.persistOutages()
      console.log('[run_full_backfill] pass', pass, 'wrote:', wroteT, 'target rows,', wroteN, 'network rows')
      totalTarget += wroteT
      totalNetwork += wroteN
      if (wroteT===0 && wroteN===0) { console.log('[run_full_backfill] no more rows to write; stopping'); break }
      await sleep(200)
    }catch(e){
      console.error('[run_full_backfill] error during pass', pass, e && e.stack || e)
      await sleep(500)
    }
  }

  const dbHandle = db.getDb()
  const afterNet = dbHandle.get('SELECT COUNT(*) as c FROM network_outages')
  const afterTarget = dbHandle.get('SELECT COUNT(*) as c FROM target_outages')
  console.log('[run_full_backfill] totals written this run:', { totalTarget, totalNetwork })
  console.log('[run_full_backfill] final counts:', { network_outages: afterNet.c, target_outages: afterTarget.c })

  // Show a few sample rows
  const sampleNet = dbHandle.all('SELECT start,end,duration_ms,outage_type,ongoing FROM network_outages ORDER BY start DESC LIMIT 10')
  const sampleTarget = dbHandle.all('SELECT start,host,end,duration_ms,ongoing FROM target_outages ORDER BY start DESC LIMIT 10')
  console.log('[run_full_backfill] sample network_outages:', JSON.stringify(sampleNet, null, 2))
  console.log('[run_full_backfill] sample target_outages:', JSON.stringify(sampleTarget, null, 2))

  console.log('[run_full_backfill] done')
  process.exit(0)
}catch(e){
  console.error('[run_full_backfill] fatal error', e && e.stack || e)
  process.exit(1)
}
