#!/usr/bin/env node
import { getDb } from '../db.js'

function normalizeHostString(s) {
  if (!s || typeof s !== 'string') return ''
  try {
    let t = s.trim()
    t = t.replace(/^https?:\/\//i, '')
    t = t.replace(/\/$/, '')
    t = t.replace(/:\d+$/, '')
    return t.toLowerCase()
  } catch {
    return s
  }
}

function main() {
  const db = getDb()
  try {
    let rows = []
    try {
      rows = db.all('SELECT rowid AS id, host, start, end FROM target_outages')
      console.log('[normalize_hosts] rows fetched:', rows.length)
    } catch (e) {
      console.error('[normalize_hosts] SELECT target_outages failed:', e && e.message)
      throw e
    }
    // Rebuild target_outages into a temp table with normalized hosts, using INSERT OR IGNORE to dedupe
    const fullRows = db.all('SELECT start, host, end, duration_ms, uptime_before_ms, outage_type, ongoing, created_at FROM target_outages')
    console.log('[normalize_hosts] full rows to process:', fullRows.length)

    // Create temp table (drop if exists)
    db.exec(`DROP TABLE IF EXISTS target_outages_new;`)
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

    const insertStmt = db.prepare('INSERT OR IGNORE INTO target_outages_new (start, host, end, duration_ms, uptime_before_ms, outage_type, ongoing, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    let inserted = 0
    for (const r of fullRows) {
      const norm = normalizeHostString(r.host || '')
      try {
        insertStmt.run([r.start, norm, r.end, r.duration_ms, r.uptime_before_ms, r.outage_type, r.ongoing, r.created_at])
        inserted++
      } catch (e) {
        console.error('[normalize_hosts] insert row failed', { start: r.start, host: r.host, norm, err: e && e.message })
        throw e
      }
    }
    console.log('[normalize_hosts] inserted into target_outages_new:', inserted)

    // Replace old table with new one (backup then rename)
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE target_outages RENAME TO target_outages_old')
      db.exec('ALTER TABLE target_outages_new RENAME TO target_outages')
      db.exec('DROP TABLE IF EXISTS target_outages_old')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }

    const initialCount = db.get('SELECT COUNT(*) AS n FROM target_outages').n
    console.log(`[normalize_hosts] rebuilt target_outages: count=${initialCount}`)

    let before = 0
    try {
      before = db.get('SELECT COUNT(*) AS n FROM target_outages').n
    } catch (e) {
      console.error('[normalize_hosts] COUNT before dedupe failed:', e && e.message)
      throw e
    }
    // Delete duplicate rows keeping the lowest rowid per (host,start,end)
    try {
      db.exec("DELETE FROM target_outages WHERE rowid NOT IN (SELECT MIN(rowid) FROM target_outages GROUP BY host, start, end);")
    } catch (e) {
      console.error('[normalize_hosts] dedupe DELETE failed:', e && e.message)
      throw e
    }
    let after = 0
    try {
      after = db.get('SELECT COUNT(*) AS n FROM target_outages').n
    } catch (e) {
      console.error('[normalize_hosts] COUNT after dedupe failed:', e && e.message)
      throw e
    }
    console.log(`[normalize_hosts] deduped target_outages: before=${before} after=${after} deleted=${before-after}`)

    // Print sample rows for verification
    const sample = db.all('SELECT rowid AS id, host, start, end, duration_ms, ongoing FROM target_outages ORDER BY start DESC LIMIT 10')
    console.log('[normalize_hosts] sample rows (latest 10):')
    for (const s of sample) console.log(JSON.stringify(s))
  } catch (err) {
    console.error('[normalize_hosts] error:', (err && err.stack) || err)
    process.exit(2)
  }
}

main()
