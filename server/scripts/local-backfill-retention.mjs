import { getDb } from '../db.js'

async function run() {
  try {
    const db = getDb()
    const tables = ['audit_log','device_events','internet_summary','daily_event_summary','alerts','mtr_snapshots']
    for (const name of tables) {
      try {
        console.log(`[backfill] Updating ${name}`)
        db.run(`UPDATE ${name} SET ts = updated_at WHERE ts IS NULL AND typeof(updated_at) = 'integer'`)
        const remaining = db.get(`SELECT COUNT(*) as c FROM ${name} WHERE ts IS NULL`)?.c ?? 0
        console.log(`[backfill] ${name}: remaining null ts = ${remaining}`)
      } catch (e) {
        console.warn(`[backfill] Skipping ${name}: ${e.message}`)
      }
    }
    console.log('[backfill] Done')
  } catch (e) {
    console.error('Backfill failed:', e)
    process.exit(1)
  }
}

run()
