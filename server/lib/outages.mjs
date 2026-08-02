// Centralized outage computation helpers
import { getDb } from '../db.js'
import { loadConfig } from '../config.js'

function parseInternetCheckRow(row) {
  try {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    return {
      ts: Number(row.ts),
      ok: Boolean(payload.ok),
      outage_type: payload.outage_type ?? null,
      payload,
    }
  } catch {
    return null
  }
}

export function loadInternetCheckRows(db, from, to) {
  const rows = db.all(
    `SELECT ts, payload FROM audit_log WHERE event = 'internet.check' AND ts >= ? AND ts <= ? ORDER BY ts ASC`,
    [from, to]
  )
  const previous = db.get(
    `SELECT ts, payload FROM audit_log WHERE event = 'internet.check' AND ts < ? ORDER BY ts DESC LIMIT 1`,
    [from]
  )
  const all = [previous, ...rows].filter(Boolean).map(parseInternetCheckRow).filter(Boolean)
  // Normalize timestamps: some environments store ts in seconds instead of ms.
  if (all.length > 0 && all[0].ts && all[0].ts < 1e12) {
    for (const r of all) r.ts = Number(r.ts) * 1000
  }
  return all
}

export function computeWeightedInternetUptime(checks, from, to) {
  if (!checks.length || to <= from) return 0
  const series = checks.map(check => ({ ...check }))
  if (series[0].ts > from) {
    series.unshift({ ...series[0], ts: from })
  }

  let upMs = 0
  let totalMs = 0
  for (let i = 0; i < series.length; i++) {
    const current = series[i]
    const next = series[i + 1]
    const intervalStart = Math.max(current.ts, from)
    const intervalEnd = Math.min(next?.ts ?? to, to)
    if (intervalEnd <= intervalStart) continue
    const delta = intervalEnd - intervalStart
    totalMs += delta
    if (current.ok) upMs += delta
  }

  return totalMs > 0 ? parseFloat(((upMs / totalMs) * 100).toFixed(3)) : 0
}

export function pairOutagesFromChecks(checks, nowMs = Date.now()) {
  const outages = []
  let downTs = null
  let downType = null
  let lastUpTs = null

  for (const row of checks) {
    // Ignore diagnostic/sample checks (these are instrumented runs, e.g. interval captures)
    // They set `outage_mode` or `interval_seconds` in the payload and should not
    // be treated as real outages for pairing/persistence.
    try {
      const pm = row.payload ?? {}
      if (pm.outage_mode === true || (pm.interval_seconds != null && pm.interval_seconds !== 0)) {
        // Treat diagnostic checks as 'non-outage' for uptime tracking
        if (row.ok) {
          // update lastUpTs so short diagnostic sequences don't reset uptimeBefore
          lastUpTs = row.ts
        }
        continue
      }
    } catch { /* ignore payload inspection errors */ }
    // Compute a derived `ok` using configured hosts + detection mode when payload contains per-result details
    let derivedOk = row.ok
    try {
      const cfg = loadConfig()
      const cfgHosts = (cfg && cfg.network && Array.isArray(cfg.network.connectivity_hosts)) ? cfg.network.connectivity_hosts : []
      const results = Array.isArray(row.payload?.results) ? row.payload.results : []
      if (cfgHosts.length > 0 && results.length > 0) {
        const mode = (process.env.OUTAGE_DETECT_MODE || 'all').toLowerCase()
        let failures = 0
        for (const h of cfgHosts) {
          const match = results.find(r => (r.host === h || r.url === h))
          if (!(match && match.ok)) failures++
          }
          if (mode === 'all') derivedOk = failures === 0
          else if (mode === 'any') derivedOk = failures < cfgHosts.length
          else derivedOk = failures < Math.ceil(cfgHosts.length / 2)
      }
    } catch (_) { /* ignore */ }

    if (!derivedOk && downTs === null) {
      // Prefer payload.detected_at when provided by the check payload and
      // when it appears reasonable (not in the future, not older than 7 days,
      // and not after the check row timestamp).
      try {
        const detectedRaw = row.payload?.detected_at ?? null
        let detected = detectedRaw ? Number(detectedRaw) : null
        if (detected && detected < 1e12) detected = detected * 1000
        const now = Date.now()
        if (detected && detected <= row.ts && detected <= now && (row.ts - detected) <= 7 * 24 * 3600 * 1000) {
          downTs = detected
        } else {
          downTs = row.ts
        }
      } catch {
        downTs = row.ts
      }
      downType = row.outage_type ?? null
    } else if (derivedOk && downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: row.ts, durationMs: row.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
      lastUpTs = row.ts
      downTs = null
      downType = null
    } else if (derivedOk) {
      lastUpTs = row.ts
    }
  }

  if (downTs !== null) {
    const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
    outages.push({ start: downTs, end: null, durationMs: nowMs - downTs, uptimeBeforeMs, outage_type: downType, ongoing: true })
  }

  return outages
}

// Compute outages for window [from,to]. Returns clipped outage objects (start,end,durationMs,uptimeBeforeMs,outage_type,ongoing)
export function computeOutages(db, from, to) {
  const checks = loadInternetCheckRows(db, from, to)
  let outages = []
  let usedPersistedRows = false

  try {
    const persisted = db.all(
      `SELECT start, end, duration_ms, outage_type, ongoing, created_at
       FROM network_outages
       WHERE start <= ?
       ORDER BY start ASC`,
      [to]
    )
    if (persisted && persisted.length > 0) {
      usedPersistedRows = true
      let lastEnd = null
      for (const row of persisted) {
        // Normalize persisted timestamps: older records may have been stored in seconds.
        let start = Number(row.start)
        let end = row.end == null ? null : Number(row.end)
        if (start && start < 1e12) start = start * 1000
        if (end && end < 1e12) end = end * 1000
        // Prefer computing duration from start/end when available; fall back to stored duration_ms.
        const durationMs = end != null ? Math.max(0, end - start) : Number(row.duration_ms ?? Math.max(0, Date.now() - start))
        const uptimeBeforeMs = lastEnd !== null ? start - lastEnd : null
        if ((end == null || end >= from) && start <= to) outages.push({
          start,
          end,
          durationMs,
          uptimeBeforeMs,
          outage_type: row.outage_type ?? null,
          ongoing: Number(row.ongoing) === 1,
        })
        lastEnd = end ?? (start + durationMs)
      }
    }
  } catch (e) {
    usedPersistedRows = false
  }

  if (!usedPersistedRows) {
    // Fallback to audit_log pairing
    let events = db.all(`SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`)
    if (events && events.length > 0 && events[0].ts && events[0].ts < 1e12) {
      events = events.map(e => ({ ...e, ts: Number(e.ts) * 1000 }))
    }

    let downTs = null
    let downType = null
    let lastUpTs = null

    if (!events || events.length === 0) {
      const checksAll = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC`)
      for (const c of checksAll) {
        let p = null
        try { p = JSON.parse(c.payload) } catch { p = null }
        const ok = p ? Boolean(p.ok) : false
        if (!ok && downTs === null) {
          downTs = c.ts
          downType = p?.outage_type ?? null
        } else if (ok && downTs !== null) {
          const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
          outages.push({ start: downTs, end: c.ts, durationMs: c.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
          lastUpTs = c.ts
          downTs = null
          downType = null
        } else if (ok) {
          lastUpTs = c.ts
        }
      }
    } else {
      for (const e of events) {
          if (e.event === 'internet.down' && downTs === null) {
            // Prefer payload.detected_at when available and reasonable, to capture
            // the moment the failure was first observed (may precede the audit row ts).
            try {
              const p = JSON.parse(e.payload)
              downType = p.outage_type ?? null
              let detected = p && p.detected_at ? Number(p.detected_at) : null
              // Normalize seconds -> ms
              if (detected && detected < 1e12) detected = detected * 1000
              const now = Date.now()
              // Accept detected if it's not in the future, not older than 7 days, and not unreasonably far before the event row
              if (detected && detected <= e.ts && detected <= now && (e.ts - detected) <= 7 * 24 * 3600 * 1000) {
                downTs = detected
              } else {
                downTs = e.ts
              }
            } catch {
              downTs = e.ts
              downType = null
            }
          } else if (e.event === 'internet.up' && downTs !== null) {
            const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
            outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
            lastUpTs = e.ts
            downTs = null
            downType = null
          } else if (e.event === 'internet.up') {
            lastUpTs = e.ts
          }
      }
    }
    if (downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, uptimeBeforeMs, outage_type: downType, ongoing: true })
    }
  }

  // If we have fresh internet.check rows, prefer pairing those only when persisted rows
  // were NOT used. Persisted `network_outages` should be authoritative when present.
  if (!usedPersistedRows && checks.length > 0) {
    outages = pairOutagesFromChecks(checks)
    // When pairing from `internet.check` rows we now prefer a payload-level
    // `detected_at` timestamp (when available and reasonable) so outage
    // start times reflect when the failure was first observed, not just
    // the first failing check row.
  }

  // Clip outages to the requested window so durations reflect only the selected range.
  const nowMs = Date.now()
  const clipped = outages
    .map(o => {
      const origStart = o.start
      const origEnd = o.end
      const clippedStart = Math.max(origStart, from)
      const clippedEndRaw = origEnd != null ? Math.min(origEnd, to) : (o.ongoing ? Math.min(nowMs, to) : null)
      const clippedEnd = clippedEndRaw != null && clippedEndRaw >= clippedStart ? clippedEndRaw : (clippedEndRaw != null ? clippedEndRaw : null)
      const durationMs = clippedEnd != null ? (clippedEnd - clippedStart) : (o.ongoing ? Math.max(0, nowMs - clippedStart) : 0)

      let uptimeBeforeMs = o.uptimeBeforeMs
      if (uptimeBeforeMs != null) {
        const lastUpTs = origStart - uptimeBeforeMs
        if (lastUpTs < from) {
          uptimeBeforeMs = Math.max(0, origStart - from)
        }
      }

      return { ...o, start: clippedStart, end: clippedEnd, durationMs, uptimeBeforeMs }
    })
    .filter(o => (!o.end || o.end >= from) && o.start <= to)
    .reverse()

  return clipped
}

export function computeOutagesSummary(db, from, to) {
  const outages = computeOutages(db, from, to)
  const totalDowntimeMs = outages.reduce((s, o) => s + (o.durationMs || 0), 0)
  const longestMs = outages.length ? Math.max(...outages.map(o => o.durationMs || 0)) : 0
  return { outages, totalDowntimeMs, longestMs, totalOutages: outages.length }
}
