#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { getDb, getDbPath } from '../db.js'
import { loadInternetCheckRows, pairOutagesFromChecks } from '../lib/outages.mjs'

function normalizeHostString(s) {
  if (!s || typeof s !== 'string') return ''
  try {
    let t = s.trim()
    t = t.replace(/^https?:\/\//i, '')
    t = t.replace(/\/$/, '')
    t = t.replace(/:\d+$/, '')
    return t.toLowerCase()
  } catch { return s }
}

async function main() {
  const db = getDb()
  const dbPath = getDbPath()
  const now = Date.now()
  const bakPath = `${dbPath}.rebuild.${now}.bak`

  try {
    console.log('[rebuild_outages] backing up DB:', dbPath, '->', bakPath)
    fs.copyFileSync(dbPath, bakPath)
  } catch (e) {
    console.error('[rebuild_outages] DB backup failed:', e && e.message)
    process.exit(2)
  }

  try {
    // Rebuild target_outages
    const hasTarget = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='target_outages'").length > 0
    if (!hasTarget) {
      console.log('[rebuild_outages] no target_outages table found; skipping')
    } else {
      const rows = db.all('SELECT start, host, end, duration_ms, uptime_before_ms, outage_type, ongoing, created_at FROM target_outages')
      console.log('[rebuild_outages] fetched target_outages rows:', rows.length)

      // Build map keyed by start + normalized host; choose keeper row per key
      const map = new Map()
      for (const r of rows) {
        const norm = normalizeHostString(r.host || '')
        if (!norm) continue
        const key = `${r.start}::${norm}`
        if (!map.has(key)) { map.set(key, r); continue }
        const cur = map.get(key)
        // prefer closed (end != null) row, else keep earliest created_at
        if ((cur.end == null) && (r.end != null)) { map.set(key, r); continue }
        if ((cur.end == null) && (r.end == null) && (r.created_at && cur.created_at && r.created_at < cur.created_at)) { map.set(key, r); continue }
      }

      // Create new table and insert
      db.exec('DROP TABLE IF EXISTS target_outages_new')
      db.exec(`CREATE TABLE target_outages_new (
        start       INTEGER NOT NULL,
        host        TEXT    NOT NULL,
        end         INTEGER,
        duration_ms INTEGER NOT NULL,
        uptime_before_ms INTEGER,
        outage_type TEXT,
        ongoing     INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (start, host)
      );`)

      const ins = db.prepare('INSERT OR IGNORE INTO target_outages_new (start, host, end, duration_ms, uptime_before_ms, outage_type, ongoing, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      let inserted = 0
      for (const [k, r] of map.entries()) {
        const norm = normalizeHostString(r.host || '')
        try { ins.run([r.start, norm, r.end, r.duration_ms, r.uptime_before_ms, r.outage_type, r.ongoing, r.created_at || now]) ; inserted++ } catch (e) { console.warn('[rebuild_outages] insert target row failed', e && e.message) }
      }
      console.log('[rebuild_outages] inserted unique target_outages rows:', inserted)

      // Swap tables
      db.exec('BEGIN')
      try {
        db.exec('ALTER TABLE target_outages RENAME TO target_outages_old')
        db.exec('ALTER TABLE target_outages_new RENAME TO target_outages')
        db.exec('DROP TABLE IF EXISTS target_outages_old')
        db.exec('COMMIT')
        console.log('[rebuild_outages] swapped target_outages table')
      } catch (e) { db.exec('ROLLBACK'); throw e }
    }

    // Rebuild network_outages from checks (full history)
    const hasNetwork = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='network_outages'").length > 0
    if (!hasNetwork) {
      console.log('[rebuild_outages] no network_outages table found; skipping')
    } else {
      // Determine time range for checks: full range
      const minRow = db.get("SELECT MIN(ts) AS ts FROM audit_log WHERE event = 'internet.check'")
      let from = (minRow && minRow.ts) ? Number(minRow.ts) : 0
      if (from && from < 1e12) from = from * 1000
      if (!from) from = 0
      const to = Date.now()
      console.log('[rebuild_outages] computing checks from-to:', from, to)

      const checks = loadInternetCheckRows(db, from, to)
      console.log('[rebuild_outages] loaded checks:', checks.length)
      const outages = pairOutagesFromChecks(checks, Date.now())
      console.log('[rebuild_outages] computed outages:', outages.length)

      db.exec('DROP TABLE IF EXISTS network_outages_new')
      db.exec(`CREATE TABLE network_outages_new (
        start       INTEGER PRIMARY KEY,
        end         INTEGER,
        duration_ms INTEGER NOT NULL,
        uptime_before_ms INTEGER,
        outage_type TEXT,
        ongoing     INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );`)
      const insNet = db.prepare('INSERT OR REPLACE INTO network_outages_new (start, end, duration_ms, uptime_before_ms, outage_type, ongoing, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      let netInserted = 0
      for (const o of outages) {
        try { insNet.run([o.start, o.end, o.durationMs || 0, o.uptimeBeforeMs || null, o.outage_type || null, o.ongoing ? 1 : 0, now]); netInserted++ } catch (e) { console.warn('[rebuild_outages] insert network row failed', e && e.message) }
      }
      console.log('[rebuild_outages] inserted network_outages rows:', netInserted)

      db.exec('BEGIN')
      try {
        db.exec('ALTER TABLE network_outages RENAME TO network_outages_old')
        db.exec('ALTER TABLE network_outages_new RENAME TO network_outages')
        db.exec('DROP TABLE IF EXISTS network_outages_old')
        db.exec('COMMIT')
        console.log('[rebuild_outages] swapped network_outages table')
      } catch (e) { db.exec('ROLLBACK'); throw e }
    }

    // Print final counts and sample rows
    try {
      const nNet = db.get('SELECT COUNT(*) AS n FROM network_outages').n
      const nTar = db.get('SELECT COUNT(*) AS n FROM target_outages').n
      console.log('[rebuild_outages] final counts network_outages=', nNet, ' target_outages=', nTar)
      const sampleNet = db.all('SELECT start, end, duration_ms, outage_type, ongoing FROM network_outages ORDER BY start DESC LIMIT 10')
      const sampleTar = db.all('SELECT start, host, end, duration_ms, ongoing FROM target_outages ORDER BY start DESC LIMIT 10')
      console.log('[rebuild_outages] sample network_outages:')
      sampleNet.forEach(r => console.log(JSON.stringify(r)))
      console.log('[rebuild_outages] sample target_outages:')
      sampleTar.forEach(r => console.log(JSON.stringify(r)))
    } catch (e) { console.warn('[rebuild_outages] final reporting failed', e && e.message) }

    console.log('[rebuild_outages] done')
  } catch (err) {
    console.error('[rebuild_outages] fatal error:', (err && err.stack) || err)
    process.exit(3)
  }
}

main()
