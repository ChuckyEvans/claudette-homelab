#!/usr/bin/env node
import fs from 'fs'

async function loadDb() {
  try { return (await import('/app/server/db.js')).getDb() } catch {}
  return (await import('../server/db.js')).getDb()
}

function parseFailedTargetsFromPayload(p) {
  if (!p) return []
  if (Array.isArray(p.failedTargets)) return p.failedTargets
  if (Array.isArray(p.results)) {
    const res = p.results
    const out = []
    for (const r of res) {
      if (r.target && ('direct' in r || 'tun' in r)) {
        if (!r.direct && !r.tun) out.push(r.target)
      } else if (r.host && ('ok' in r)) {
        if (!r.ok) out.push(r.host)
      }
    }
    return out
  }
  return []
}

async function main() {
  const db = await loadDb()
  const downs = db.all("SELECT rowid, ts, payload FROM audit_log WHERE event='internet.down' ORDER BY ts ASC")
  console.log(`Found ${downs.length} internet.down rows`)
  for (const d of downs) {
    let downPayload = null
    try { downPayload = JSON.parse(d.payload) } catch {}
    const upRow = db.get("SELECT ts, payload FROM audit_log WHERE event='internet.up' AND ts > ? ORDER BY ts ASC LIMIT 1", [d.ts])
    let upPayload = null
    if (upRow && upRow.payload) {
      try { upPayload = JSON.parse(upRow.payload) } catch {}
    }
    const upTs = upRow ? Number(upRow.ts) : null
    const duration = upTs ? (upTs - Number(d.ts)) : null
    const failed = parseFailedTargetsFromPayload(downPayload)
    console.log('---')
    console.log('down_row:', d.rowid, 'down_ts:', d.ts, 'up_ts:', upTs, 'duration_ms:', duration)
    console.log('failed_targets:', failed.length ? failed.join(', ') : '(none)')
    if (downPayload) console.log('down_payload_summary:', JSON.stringify(downPayload.failedTargets ? { failedTargets: downPayload.failedTargets } : { resultsCount: (downPayload.results||[]).length }))
    if (upPayload) console.log('up_payload_summary:', JSON.stringify({ resultsCount: (upPayload.results||[]).length }))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
