#!/usr/bin/env node
// Lightweight connectivity check script run inside container by cron.
// Safe: exits silently on any error.
(async function main(){
  try {
    const { getDb } = await import('./server/db.js').catch(()=>null) || await import('./db.js')
    if (!getDb) return console.log('[conn_check] no db module')
    const db = getDb()
    if (!db) return console.log('[conn_check] no db handle')
    // Previously wrote heartbeat rows into outage_diagnostics; diagnostics table is now archived/disabled.
    // No-op to avoid creating or writing to the diagnostics table during normal test/dev runs.
    console.log('[conn_check] diagnostics heartbeat disabled (archived or removed)')
  } catch { /* ignore */ }
})()
