#!/usr/bin/env node
import { getDb } from '../server/db.js'
try{
  const db = getDb()
  const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outage_diagnostics'").get()
  if(!info){
    console.log('No outage_diagnostics table found — nothing to archive')
    process.exit(0)
  }
  db.prepare('BEGIN').run()
  db.prepare('ALTER TABLE outage_diagnostics RENAME TO outage_diagnostics_archived').run()
  try{ db.prepare('ALTER INDEX idx_outage_captured RENAME TO idx_outage_archived_captured').run() }catch(e){}
  db.prepare('COMMIT').run()
  console.log('Renamed outage_diagnostics -> outage_diagnostics_archived')
}catch(err){
  try{ getDb().prepare('ROLLBACK').run() }catch(e){}
  console.error('Archive failed:', err.message)
  process.exit(2)
}
