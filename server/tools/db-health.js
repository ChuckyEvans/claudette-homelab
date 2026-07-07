#!/usr/bin/env node
// Lightweight DB health check helper.
import { getDbPath } from '../db.js'
import { spawnSync } from 'node:child_process'
import fs from 'fs'

const dbPath = getDbPath()
if (!fs.existsSync(dbPath)) {
  console.error('DB not found at', dbPath)
  process.exit(2)
}

const res = spawnSync('sqlite3', [dbPath, "PRAGMA integrity_check;"], { encoding: 'utf8' })
if (res.error) {
  console.error('sqlite3 exec failed:', res.error.message)
  process.exit(3)
}
const out = (res.stdout || '').trim()
console.log('integrity_check ->', out)
if (out !== 'ok') process.exit(4)

const rows = spawnSync('sqlite3', [dbPath, "SELECT COUNT(*) FROM network_outages;"], { encoding: 'utf8' })
if (!rows.error) console.log('network_outages count ->', (rows.stdout || '').trim())
process.exit(0)
