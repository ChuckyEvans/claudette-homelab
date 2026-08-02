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

// Prefer calling sqlite3 CLI if available, but fall back to the bundled
// node-sqlite3-wasm Database when sqlite3 is not installed on the system.
try {
  const probe = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' })
  if (!probe.error) {
    const res = spawnSync('sqlite3', [dbPath, "PRAGMA integrity_check;"], { encoding: 'utf8' })
    if (res.error) throw res.error
    const out = (res.stdout || '').trim()
    console.log('integrity_check ->', out)
    if (out !== 'ok') process.exit(4)
    const rows = spawnSync('sqlite3', [dbPath, "SELECT COUNT(*) FROM network_outages;"], { encoding: 'utf8' })
    if (!rows.error) console.log('network_outages count ->', (rows.stdout || '').trim())
    process.exit(0)
  }
} catch {
  // fall through to JS-based check
}

// Fallback: use node-sqlite3-wasm to run checks without requiring external binary
try {
  const pkg = await import('node-sqlite3-wasm')
  const { Database } = pkg
  const db = new Database(dbPath)
  const ok = db.get("PRAGMA integrity_check;")
  // node-sqlite3-wasm returns rows as arrays or objects; coerce to string
  const out = (typeof ok === 'string' ? ok : (ok && Object.values(ok)[0])) || ''
  console.log('integrity_check ->', String(out))
  if (String(out).trim() !== 'ok') process.exit(4)
  try {
    const r = db.get('SELECT COUNT(*) AS n FROM network_outages')
    console.log('network_outages count ->', r && r.n != null ? String(r.n) : '0')
  } catch {}
  process.exit(0)
} catch (err) {
  console.error('db-health fallback failed:', err && err.message)
  process.exit(3)
}
