#!/usr/bin/env node
import fs from 'fs'
import { getDb, getDbPath } from '../db.js'

// Local copy of normalizeHostString so the script can run even if the
// container's `db.js` doesn't export the helper (defensive/backfill mode).
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

function sanitizeResult(r) {
  try {
    const host = normalizeHostString(String(r?.host || r?.url || ''))
    return { host, ok: !!r?.ok, ms: Number(r?.ms || 0), ts: r?.ts ? Number(r.ts) : undefined }
  } catch { return { host: '', ok: !!r?.ok, ms: Number(r?.ms || 0), ts: r?.ts ? Number(r.ts) : undefined } }
}

async function main() {
  const dbPath = getDbPath()
  const bak = dbPath + `.backfill.normalize.${Date.now()}.bak`
  try {
    fs.copyFileSync(dbPath, bak)
    console.log('[backfill] DB backup created:', bak)
  } catch (e) {
    console.error('[backfill] DB backup failed:', e.message)
    process.exit(1)
  }

  const db = getDb()
  const rows = db.all("SELECT id, ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC")
  console.log('[backfill] rows to inspect:', rows.length)
  let updated = 0
  for (const row of rows) {
    if (!row || !row.payload) continue
    let parsed = null
    try { parsed = JSON.parse(row.payload) } catch { parsed = null }
    if (!parsed || typeof parsed !== 'object') continue

    let changed = false
    try {
      if (Array.isArray(parsed.results)) {
        const newResults = parsed.results.map(r => sanitizeResult(r))
        if (JSON.stringify(newResults) !== JSON.stringify(parsed.results)) { parsed.results = newResults; changed = true }
      }
    } catch (e) { /* ignore per-row errors */ }

    try {
      if (Array.isArray(parsed.attempts)) {
        const newAttempts = parsed.attempts.map(a => Array.isArray(a) ? a.map(r => sanitizeResult(r)) : [])
        if (JSON.stringify(newAttempts) !== JSON.stringify(parsed.attempts)) { parsed.attempts = newAttempts; changed = true }
      }
    } catch (e) { }

    try {
      if (Array.isArray(parsed.vpn_results)) {
        const newVpn = parsed.vpn_results.map(r => sanitizeResult(r))
        if (JSON.stringify(newVpn) !== JSON.stringify(parsed.vpn_results)) { parsed.vpn_results = newVpn; changed = true }
      }
    } catch (e) { }

    if (changed) {
      // Retry on transient DB locks
      const maxAttempts = 8
      let attempt = 0
      while (true) {
        try {
          attempt++
          db.run('UPDATE audit_log SET payload = ? WHERE id = ?', [JSON.stringify(parsed), row.id])
          updated++
          if (updated % 100 === 0) console.log('[backfill] updated', updated, 'rows so far')
          break
        } catch (e) {
          const msg = e && e.message || ''
          if (attempt >= maxAttempts || !/locked|busy/i.test(msg)) {
            console.error('[backfill] failed to update row id', row.id, msg)
            break
          }
          const waitMs = 50 * Math.pow(2, attempt)
          await new Promise(r => setTimeout(r, waitMs))
        }
      }
    }
  }

  console.log('[backfill] complete. rows inspected=', rows.length, 'updated=', updated)
}

main().catch(e => { console.error('[backfill] fatal:', e && e.message); process.exit(2) })
