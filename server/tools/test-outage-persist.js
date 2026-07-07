#!/usr/bin/env node
import { audit, persistOutages, getDb } from '../db.js'

async function main() {
  const now = Date.now()
  const detected = now - 5000 // detected 5s ago
  try {
    // Use audit() which enqueues writes and handles retries
    await audit('internet.down', { detected_at: detected, outage_type: 'infra' }, 'test', null)
    await audit('internet.up', { detected_at: detected }, 'test', null)

    console.log('Inserted test audit rows - running persistOutages()')
    const n = persistOutages()
    console.log('persistOutages returned', n)
    const db = getDb()
    const row = db.get('SELECT start,end,duration_ms,outage_type,ongoing,created_at FROM network_outages ORDER BY start DESC LIMIT 1')
    console.log('Latest network_outages row:', row)
  } catch (e) {
    console.error('Test failed:', e && e.message)
    process.exit(2)
  }
}

main()
