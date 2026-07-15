import { Router } from 'express'
import { exec } from 'child_process'
import { getDb } from '../db.js'
// PDF generation is required lazily where used
import { runSpeedTest, runVpnSpeedTest, getSpeedTestHistory, isInterfaceUp } from '../utils/speedtest.js'
import { loadConfig } from '../config.js'
// use existing `exec` imported above

const router = Router()

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

function parseInternetCheckRow(row) {
  try {
    const payload = JSON.parse(row.payload)
    return {
      ts: Number(row.ts),
      ok: Boolean(payload.ok),
      outage_type: payload.outage_type ?? null,
    }
  } catch {
    return null
  }
}

function loadInternetCheckRows(db, from, to) {
  const rows = db.all(
    `SELECT ts, payload FROM audit_log WHERE event = 'internet.check' AND ts >= ? AND ts <= ? ORDER BY ts ASC`,
    [from, to]
  )
  const previous = db.get(
    `SELECT ts, payload FROM audit_log WHERE event = 'internet.check' AND ts < ? ORDER BY ts DESC LIMIT 1`,
    [from]
  )
  return [previous, ...rows].filter(Boolean).map(parseInternetCheckRow).filter(Boolean)
}

function computeWeightedInternetUptime(checks, from, to) {
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

function pairOutagesFromChecks(checks, nowMs = Date.now()) {
  const outages = []
  let downTs = null
  let downType = null
  let lastUpTs = null

  for (const row of checks) {
    if (!row.ok && downTs === null) {
      downTs = row.ts
      downType = row.outage_type ?? null
    } else if (row.ok && downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: row.ts, durationMs: row.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
      lastUpTs = row.ts
      downTs = null
      downType = null
    } else if (row.ok) {
      lastUpTs = row.ts
    }
  }

  if (downTs !== null) {
    const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
    outages.push({ start: downTs, end: null, durationMs: nowMs - downTs, uptimeBeforeMs, outage_type: downType, ongoing: true })
  }

  return outages
}

// Compute outages given DB and range. Returns array of outage objects.
function computeOutages(db, from, to) {
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
        const start = Number(row.start)
        const end = row.end == null ? null : Number(row.end)
        const durationMs = Number(row.duration_ms ?? (end != null ? end - start : Date.now() - start))
        const uptimeBeforeMs = lastEnd !== null ? start - lastEnd : null
        if ((end == null || end >= from) && start <= to) outages.push({
          start,
          end,
          durationMs,
          uptimeBeforeMs,
          outage_type: row.outage_type ?? null,
          ongoing: Number(row.ongoing) === 1,
        })
        lastEnd = end ?? start + durationMs
      }
    }
  } catch {
    usedPersistedRows = false
  }

  if (!usedPersistedRows) {
    // Fallback for older databases that have not yet populated network_outages.
    let events = db.all(
      `SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`
    )

    // Normalize timestamps: some environments store ts in seconds instead of ms.
    // If the first timestamp looks like seconds (less than 1e12), convert all to ms.
    if (events && events.length > 0 && events[0].ts && events[0].ts < 1e12) {
      events = events.map(e => ({ ...e, ts: Number(e.ts) * 1000 }))
    }

    let downTs = null
    let downType = null
    let lastUpTs = null

    if (!events || events.length === 0) {
      const checks = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC`)
      for (const c of checks) {
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
          downTs = e.ts
          try { const p = JSON.parse(e.payload); downType = p.outage_type ?? null } catch { downType = null }
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
  
  // If we have fresh internet.check rows, prefer pairing those (they may be more accurate)
  if (checks.length > 0) {
    outages = pairOutagesFromChecks(checks)
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

      // Adjust uptimeBeforeMs: if the original lastUpTs is known (derived from uptimeBeforeMs),
      // and that lastUpTs is before the window start, report only the uptime observed within window.
      let uptimeBeforeMs = o.uptimeBeforeMs
      if (uptimeBeforeMs != null) {
        const lastUpTs = origStart - uptimeBeforeMs
        if (lastUpTs < from) {
          // only the portion from `from` -> origStart is observable in-window
          uptimeBeforeMs = Math.max(0, origStart - from)
        }
      }

      return { ...o, start: clippedStart, end: clippedEnd, durationMs, uptimeBeforeMs }
    })
    // Keep only outages that overlap the window
    .filter(o => (!o.end || o.end >= from) && o.start <= to)
    .reverse()

  return clipped
}

// ── Event category → which table(s) to query ─────────────────────────────────
// 'device' prefix → device_events only
// 'scan'/'service'/'threat'/'config' → audit_log only
// default (all) → both

function buildDeviceEventsQuery(from, to, eventPrefix, mac, subnetPrefix, limit, offset) {
  const conds = ['ts >= ? AND ts <= ?']
  const params = [from, to]
  if (eventPrefix)   { conds.push('event LIKE ?'); params.push(`${eventPrefix}%`) }
  if (mac) {
    const macs = mac.split(',').map(m => m.trim()).filter(Boolean)
    if (macs.length === 1) { conds.push('mac = ?'); params.push(macs[0]) }
    else if (macs.length > 1) { conds.push(`mac IN (${macs.map(() => '?').join(',')})`); params.push(...macs) }
  }
  if (subnetPrefix)  { conds.push('ip LIKE ?');     params.push(`${subnetPrefix}.%`) }
  const where = conds.join(' AND ')
  return {
    rows:  `SELECT ts, event, mac, ip, hostname, payload, 'device' AS source FROM device_events WHERE ${where} ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`,
    count: `SELECT COUNT(*) AS n FROM device_events WHERE ${where}`,
    params,
  }
}

function buildAuditLogQuery(from, to, eventPrefix, limit, offset) {
  // Exclude low-value noise from system events in the report view
  const EXCLUDED = `event NOT IN ('service.check','config.saved')`
  const conds = [`ts >= ? AND ts <= ?`, EXCLUDED]
  const params = [from, to]
  if (eventPrefix) { conds.push('event LIKE ?'); params.push(`${eventPrefix}%`) }
  const where = conds.join(' AND ')
  return {
    rows:  `SELECT ts, event, NULL AS mac, NULL AS ip, NULL AS hostname, payload, 'system' AS source FROM audit_log WHERE ${where} ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`,
    count: `SELECT COUNT(*) AS n FROM audit_log WHERE ${where}`,
    params,
  }
}

// GET /api/reports?from=&to=&event=&mac=&limit=50&offset=0
router.get('/', (req, res) => {
  try {
    const db     = getDb()
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200)
    const offset = Math.max(parseInt(req.query.offset) || 0,  0)
    const to     = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from   = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS
    const eventFilter  = req.query.event?.trim()  || null
    const macFilter    = req.query.mac?.trim()    || null
    const subnetParam  = req.query.subnet?.trim() || null
    const subnetPrefix = subnetParam ? subnetParam.split('/')[0].split('.').slice(0, 3).join('.') : null

    // Determine which tables to query
    const wantDevice = !eventFilter || eventFilter.startsWith('device')
    const wantSystem = !eventFilter || !eventFilter.startsWith('device')

    let allRows = []
    let total   = 0

    if (wantDevice && wantSystem && !macFilter) {
      // Use SQL UNION to let SQLite sort and limit efficiently server-side
      const unionRowsSql = `
        SELECT ts, event, mac, ip, hostname, payload, 'device' AS source FROM device_events WHERE ts >= ? AND ts <= ?
        UNION ALL
        SELECT ts, event, NULL AS mac, NULL AS ip, NULL AS hostname, payload, 'system' AS source FROM audit_log WHERE ts >= ? AND ts <= ? AND ${"event NOT IN ('service.check','config.saved')"}
        ORDER BY ts DESC
        LIMIT ? OFFSET ?
      `
      const unionCountSql = `SELECT (SELECT COUNT(*) FROM device_events WHERE ts >= ? AND ts <= ?) + (SELECT COUNT(*) FROM audit_log WHERE ts >= ? AND ts <= ? AND ${"event NOT IN ('service.check','config.saved')"}) AS n`
      const paramsRows = [from, to, from, to, limit, offset]
      const paramsCount = [from, to, from, to]
      allRows = db.all(unionRowsSql, paramsRows)
      total = db.get(unionCountSql, paramsCount).n
    } else if (wantDevice) {
      const dq = buildDeviceEventsQuery(from, to, eventFilter, macFilter, subnetPrefix, limit, offset)
      allRows = db.all(dq.rows, dq.params)
      total   = db.get(dq.count, dq.params).n
    } else {
      const aq = buildAuditLogQuery(from, to, eventFilter, limit, offset)
      allRows = db.all(aq.rows, aq.params)
      total   = db.get(aq.count, aq.params).n
    }

    // ── Summary stats for the selected period ────────────────────────────────
    const newDevices    = db.get("SELECT COUNT(*) AS n FROM device_events WHERE ts >= ? AND ts <= ? AND event = 'device.new'",     [from, to]).n
    const onlineEvents  = db.get("SELECT COUNT(*) AS n FROM device_events WHERE ts >= ? AND ts <= ? AND event = 'device.online'",  [from, to]).n
    const offlineEvents = db.get("SELECT COUNT(*) AS n FROM device_events WHERE ts >= ? AND ts <= ? AND event = 'device.offline'", [from, to]).n
    const portFinds     = db.get("SELECT COUNT(*) AS n FROM device_events WHERE ts >= ? AND ts <= ? AND event = 'device.port.open'", [from, to]).n
    const serviceDown   = db.get("SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'service.down'", [from, to]).n
    const scansRun      = db.get("SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND ts <= ? AND event LIKE 'scan.complete'", [from, to]).n

    // Aggregate persisted network checks (if table exists)
    let networkSummary = null
    try {
      const ncExists = db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='network_check_runs'")
      if (ncExists) {
        const sums = db.get(`SELECT SUM(total_targets) AS total_targets, SUM(total_outages) AS total_outages FROM network_check_runs WHERE ts >= ? AND ts <= ?`, [from, to])
        const totalTargets = Number(sums.total_targets || 0)
        const totalOutages = Number(sums.total_outages || 0)
        const uptimePct = totalTargets > 0 ? parseFloat(((1 - (totalOutages / totalTargets)) * 100).toFixed(3)) : null
        networkSummary = { totalTargets, totalOutages, uptimePct }
      }
    } catch {
      networkSummary = null
    }

    res.json({
      events: allRows.map(r => ({ ...r, payload: JSON.parse(r.payload) })),
      total,
      limit,
      offset,
      from,
      to,
      summary: { newDevices, onlineEvents, offlineEvents, portFinds, serviceDown, scansRun, networkSummary },
    })
  } catch (_err) {
    res.status(500).json({ error: _err.message })
  }
})

// GET /api/reports/chart?from=&to= — aggregated data for charts
router.get('/chart', (req, res) => {
  try {
    const db   = getDb()
    const to   = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS

    // Daily device event counts — prefer precomputed summary when available
    let daily = []
    try {
      const startDay = new Date(from).toISOString().slice(0,10)
      const endDay = new Date(to).toISOString().slice(0,10)
      // If range is at least 1 day, use daily_event_summary
      const summaryRows = db.all(`SELECT day, new_devices, online_events, offline_events, port_finds FROM daily_event_summary WHERE day >= ? AND day <= ? ORDER BY day ASC`, [startDay, endDay])
      if (summaryRows && summaryRows.length > 0) {
        daily = summaryRows.map(r => ({ date: r.day, new: r.new_devices, online: r.online_events, offline: r.offline_events, ports: r.port_finds }))
      } else {
        const devRows = db.all(`SELECT ts, event FROM device_events WHERE ts >= ? AND ts <= ?`, [from, to])
        const byDay = new Map()
        for (const r of devRows) {
          const d   = new Date(r.ts)
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
          if (!byDay.has(key)) byDay.set(key, { date: key, new: 0, online: 0, offline: 0, ports: 0 })
          const day = byDay.get(key)
          if      (r.event === 'device.new')        day.new++
          else if (r.event === 'device.online')     day.online++
          else if (r.event === 'device.offline')    day.offline++
          else if (r.event === 'device.port.open')  day.ports++
        }
        daily = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
      }
    } catch {
      daily = []
    }

    // Top ports
    const portRows = db.all(`SELECT payload FROM device_events WHERE ts >= ? AND ts <= ? AND event = 'device.port.open'`, [from, to])
    const portCounts = new Map()
    for (const r of portRows) {
      try { const p = JSON.parse(r.payload); if (p.port) portCounts.set(String(p.port), (portCounts.get(String(p.port)) ?? 0) + 1) } catch {}
    }
    const topPorts = Array.from(portCounts.entries()).map(([port, count]) => ({ port, count })).sort((a, b) => b.count - a.count).slice(0, 10)

    // Service outages per service
    const svcRows = db.all(`SELECT payload FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'service.down'`, [from, to])
    const svcCounts = new Map()
    for (const r of svcRows) {
      try { const p = JSON.parse(r.payload); if (p.name) svcCounts.set(p.name, (svcCounts.get(p.name) ?? 0) + 1) } catch {}
    }
    const serviceDowns = Array.from(svcCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)

    // Internet connectivity — at most 300 samples for charting.
    // Fetch the most-recent 300 rows (DESC) then reverse so the chart renders oldest→newest.
    // This ensures recent VPN data (which may not have existed at the start of the range) is included.
    const netRows = db.all(`SELECT ts, payload FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check' ORDER BY ts DESC LIMIT 300`, [from, to])
    netRows.reverse()
    const internet = netRows.flatMap(r => {
      try {
        const p = JSON.parse(r.payload)
        const ok = (p.results ?? []).filter(x => x.ok && x.ms != null)
        const ms = ok.length ? Math.round(ok.reduce((s, x) => s + x.ms, 0) / ok.length) : null
        const vpnOk = (p.vpn_results ?? []).filter(x => x.ok && x.ms != null)
        const vpn_ms = p.vpn_up && vpnOk.length ? Math.round(vpnOk.reduce((s, x) => s + x.ms, 0) / vpnOk.length) : null
        return [{ ts: r.ts, ok: p.ok ?? false, ms, vpn_ms }]
      } catch { return [] }
    })

    // Internet stats summary: uptime %, avg latency, check count, status changes
    // Use full window counts (not the chart-capped 300 rows) for accuracy
    const internetChecks = loadInternetCheckRows(db, from, to)
    const uptime = computeWeightedInternetUptime(internetChecks, from, to)

    const { total_checks: totalChecks } = db.get(
      `SELECT COUNT(*) AS total_checks, SUM(CASE WHEN json_extract(payload,'$.ok') = 1 THEN 1 ELSE 0 END) AS ok_checks FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check'`,
      [from, to]
    )
    const avgLatency = internet.filter(x => x.ms != null).length > 0
      ? Math.round(internet.filter(x => x.ms != null).reduce((s, x) => s + x.ms, 0) / internet.filter(x => x.ms != null).length)
      : 0
    const changes = internet.reduce((acc, cur, i) => acc + (i > 0 && internet[i-1].ok !== cur.ok ? 1 : 0), 0)

    // Failure classification: ISP (gateway ok, internet down) vs Infra (gateway also down)
    const ispFailures   = db.get(`SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check' AND json_extract(payload,'$.ok') = 0 AND json_extract(payload,'$.outage_type') = 'isp'`,   [from, to]).n
    const infraFailures = db.get(`SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check' AND json_extract(payload,'$.ok') = 0 AND json_extract(payload,'$.outage_type') = 'infra'`, [from, to]).n

    // Most-recently-seen gateway IP (from connectivity checks)
    const gwRow = db.get(`SELECT payload FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check' AND json_extract(payload,'$.gateway') IS NOT NULL ORDER BY ts DESC LIMIT 1`, [from, to])
    let latestGateway = null
    try { if (gwRow) latestGateway = JSON.parse(gwRow.payload).gateway ?? null } catch {}

    // Speed test stats summary split by via (direct vs vpn)
    const stAllRows = db.all(`SELECT download_mbps, upload_mbps, ping_ms, via FROM speedtest_results WHERE ts >= ? AND ts <= ?`, [from, to])
    const stDirect = stAllRows.filter(r => (r.via ?? 'direct') === 'direct')
    const stVpn    = stAllRows.filter(r => r.via === 'vpn')
    const speedStatsFn = (rows) => rows.length > 0 ? {
      avgDown: parseFloat((rows.reduce((s, r) => s + (r.download_mbps ?? 0), 0) / rows.length).toFixed(1)),
      avgUp:   parseFloat((rows.reduce((s, r) => s + (r.upload_mbps   ?? 0), 0) / rows.length).toFixed(1)),
      avgPing: parseFloat((rows.reduce((s, r) => s + (r.ping_ms       ?? 0), 0) / rows.length).toFixed(0)),
      count:   rows.length,
    } : null
    const speedStats    = speedStatsFn(stDirect)
    const speedStatsVpn = speedStatsFn(stVpn)

    res.json({ daily, topPorts, serviceDowns, internet, internetStats: { uptime, avgLatency, totalChecks, changes, ispFailures, infraFailures, gateway: latestGateway }, speedStats, speedStatsVpn })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/devices — list of unique devices seen in device_events for filter dropdown
router.get('/devices', (req, res) => {
  try {
    const rows = getDb().all(`
      SELECT DISTINCT mac, ip, hostname
      FROM device_events
      WHERE mac IS NOT NULL
      ORDER BY ip
    `)
    res.json({ devices: rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/internet?from=&to=&limit=&offset= — detailed internet connectivity report
router.get('/internet', (req, res) => {
  try {
    const db     = getDb()
    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const to     = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from   = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS

    // Get internet check records
    const rows = db.all(`
      SELECT ts, payload FROM audit_log
      WHERE ts >= ? AND ts <= ? AND event = 'internet.check'
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
    `, [from, to, limit, offset])

    const total = db.get(`
      SELECT COUNT(*) AS n FROM audit_log
      WHERE ts >= ? AND ts <= ? AND event = 'internet.check'
    `, [from, to]).n

    const checks = rows.map(r => {
      try {
        const p = JSON.parse(r.payload)
        const hosts = p.results ?? []
        const ok = hosts.filter(x => x.ok && x.ms != null)
        const avgMs = ok.length ? Math.round(ok.reduce((s, x) => s + x.ms, 0) / ok.length) : null
        const vpnHosts  = p.vpn_results ?? []
        const vpnOkArr  = vpnHosts.filter(x => x.ok && x.ms != null)
        const vpnAvgMs  = p.vpn_up && vpnOkArr.length ? Math.round(vpnOkArr.reduce((s, x) => s + x.ms, 0) / vpnOkArr.length) : null
        return {
          ts: r.ts,
          ok: p.ok ?? false,
          avgMs,
          hostCount: hosts.length,
          okCount: ok.length,
          hosts,
          vpn_up:       p.vpn_up      ?? false,
          vpn_ok:       p.vpn_ok      ?? null,
          vpnAvgMs,
          vpnHosts,
          outage_mode:      p.outage_mode      ?? false,
          interval_seconds: p.interval_seconds ?? null,
          attempt_count:    p.attempt_count    ?? null,
          outage_type:  p.outage_type ?? null,
          gateway_ok:   p.gateway_ok  ?? null,
          gateway:      p.gateway     ?? null,
        }
      } catch { return null }
    }).filter(Boolean)

    res.json({ checks, total, limit, offset, from, to })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/speedtest?from=&to=&limit=&offset= — speed test history
router.get('/speedtest', (req, res) => {
  try {
    const to     = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from   = req.query.from ? parseInt(req.query.from) : to - (30 * 24 * 60 * 60 * 1000)
    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const { rows, total } = getSpeedTestHistory(from, to, limit, offset)
    res.json({ results: rows, total, limit, offset, from, to })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/outages — compute internet outage periods from down/up events
router.get('/outages', (req, res) => {
  try {
    const db   = getDb()
    const to   = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS

    const windowed = computeOutages(db, from, to)
    const totalDowntimeMs = windowed.reduce((s, o) => s + o.durationMs, 0)
    const longestMs = windowed.length ? Math.max(...windowed.map(o => o.durationMs)) : 0

    // Server-side pagination support for large outage lists
    const page = Math.max(1, parseInt(req.query.page || '1'))
    const limit = Math.min(Math.max(1, parseInt(req.query.limit || '50')), 1000)
    const offset = (page - 1) * limit

    // Attach stored diagnostics (traceroute + ping detail) if available
    let diagRows = []
    try {
      diagRows = db.all(`SELECT outage_ts, traceroute, ping_detail, gateway, captured_at FROM outage_diagnostics`)
    } catch {
      // table missing or archived — continue without diagnostics
      diagRows = []
    }
      const diagMap = new Map(diagRows.map(r => [r.outage_ts, r]))
    const cfg = loadConfig()
    let windowedWithDiag = windowed.map(o => {
      const d = diagMap.get(o.start)
      if (!d) return o
      let pingDetail = null
          try { pingDetail = JSON.parse(d.ping_detail) } catch {}
      const pingHosts = cfg?.network?.connectivity_hosts ?? ['1.1.1.1']
      return { ...o, diagnostics: { traceroute: d.traceroute, ping_detail: pingDetail, gateway: d.gateway, ping_hosts: pingHosts, captured_at: d.captured_at } }
    })

    // If there are no paired outages but there are stored diagnostics (e.g. heartbeats or captured traces),
    // surface them as diagnostic-only entries so the UI isn't empty.
    if ((!windowedWithDiag || windowedWithDiag.length === 0) && diagRows && diagRows.length > 0) {
      console.debug('[reports/outages] No paired outages found — falling back to diagnostic-only entries', { diagCount: diagRows.length, from, to })
      windowedWithDiag = diagRows
        .filter(d => d.outage_ts >= from && d.outage_ts <= to)
        .map(d => {
          let pingDetail = null
          try { pingDetail = JSON.parse(d.ping_detail) } catch {}
          const pingHosts = cfg?.network?.connectivity_hosts ?? ['1.1.1.1']
          return { start: d.outage_ts, end: d.captured_at ?? null, durationMs: d.captured_at ? (d.captured_at - d.outage_ts) : 0, uptimeBeforeMs: null, outage_type: d.outage_type ?? null, ongoing: false, diagnostics: { traceroute: d.traceroute, ping_detail: pingDetail, gateway: d.gateway, ping_hosts: pingHosts, captured_at: d.captured_at } }
        }).reverse()
    }

    // Apply pagination to the returned outages
    const paged = windowedWithDiag.slice(offset, offset + limit)
    res.json({
      outages: paged,
      totalOutages: windowed.length,
      totalDowntimeMs,
      longestMs,
      page,
      limit,
    })
  } catch (_err) {
    res.status(500).json({ error: _err.message })
  }
})

// GET /api/reports/outages.csv?from=&to=
router.get('/outages.csv', (req, res) => {
  try {
    const db   = getDb()
    const to   = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS
    const rows = computeOutages(db, from, to)
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="outages_${new Date().toISOString().slice(0,10)}.csv"`)
    const header = 'start,end,duration_ms,uptime_before_ms,outage_type,ongoing\n'
    const body = rows.map(o => `${o.start},${o.end ?? ''},${o.durationMs},${o.uptimeBeforeMs ?? ''},${o.outage_type ?? ''},${o.ongoing ? '1' : '0'}`).join('\n')
    res.send(header + body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/outages.pdf?from=&to=
router.get('/outages.pdf', (req, res) => {
  try {
    // Lazy require to avoid hard dependency if not used
    const PDFDocument = require('pdfkit')
    const db   = getDb()
    const to   = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS
    const rows = computeOutages(db, from, to)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="outages_${new Date().toISOString().slice(0,10)}.pdf"`)

    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    doc.pipe(res)
    doc.fontSize(14).text('Outage Log', { align: 'left' })
    doc.moveDown(0.5)
    doc.fontSize(10)
    const cols = ['Start', 'End', 'Duration(s)', 'Type', 'Ongoing']
    // header
    doc.text(cols.join(' | '))
    doc.moveDown(0.2)
    for (const o of rows) {
      const start = new Date(o.start).toLocaleString()
      const end = o.end ? new Date(o.end).toLocaleString() : ''
      const dur = Math.round((o.durationMs || 0) / 1000)
      const type = o.outage_type || ''
      const ong = o.ongoing ? 'yes' : 'no'
      doc.text(`${start} | ${end} | ${dur} | ${type} | ${ong}`)
    }
    doc.end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// (CSV export handled earlier with /outages.csv)

// (PDF export handled earlier with /outages.pdf)

    // GET /api/reports/outages/:ts — diagnostics for a specific outage (by start timestamp)
router.get('/outages/:ts', (req, res) => {
  try {
    const ts = parseInt(req.params.ts)
    if (!ts) return res.status(400).json({ error: 'invalid ts' })
    let row = null
    try {
      row = getDb().get(`SELECT outage_ts, traceroute, ping_detail, gateway, outage_type, captured_at FROM outage_diagnostics WHERE outage_ts = ?`, [ts])
    } catch {
      return res.status(404).json({ error: 'no diagnostics stored for this outage (archived or missing)' })
    }
    if (!row) return res.status(404).json({ error: 'no diagnostics stored for this outage' })
    let pingDetail = null
    try { pingDetail = JSON.parse(row.ping_detail) } catch {}
    res.json({ ...row, ping_detail: pingDetail })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/reports/internet/traceroute — run mtr (My Traceroute) to 8.8.8.8 from the Pi
router.post('/internet/traceroute', (req, res) => {
  exec('mtr --report --no-dns --report-cycles 5 8.8.8.8 2>&1', { timeout: 120000 }, (err, stdout) => {
    res.json({ output: stdout || (err?.message ?? 'mtr unavailable') })
  })
})

// GET /api/reports/mtr-snapshots?from=&to=&type=&limit= — baseline and outage-repeat mtr history
router.get('/mtr-snapshots', (req, res) => {
  try {
    const db     = getDb()
    const to     = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from   = req.query.from ? parseInt(req.query.from) : to - (30 * 24 * 60 * 60 * 1000)
    const type   = req.query.type ?? null   // 'baseline' | 'outage_repeat' | null = both
    const limit  = Math.min(parseInt(req.query.limit) || 200, 1000)
    const rows = type
      ? db.all(`SELECT id, ts, type, outage_ts, output, captured_at FROM mtr_snapshots WHERE ts >= ? AND ts <= ? AND type = ? ORDER BY ts DESC LIMIT ?`, [from, to, type, limit])
      : db.all(`SELECT id, ts, type, outage_ts, output, captured_at FROM mtr_snapshots WHERE ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT ?`, [from, to, limit])
    const total = type
      ? db.get(`SELECT COUNT(*) AS n FROM mtr_snapshots WHERE ts >= ? AND ts <= ? AND type = ?`, [from, to, type]).n
      : db.get(`SELECT COUNT(*) AS n FROM mtr_snapshots WHERE ts >= ? AND ts <= ?`, [from, to]).n
    res.json({ snapshots: rows, total, from, to })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/reports/speedtest — trigger a manual direct speed test
router.post('/speedtest', async (req, res) => {
  try {
    const serverId = req.query.server_id ?? req.body?.server_id ?? null
    res.json({ ok: true, message: 'Direct speed test started' })
    setImmediate(() => runSpeedTest(req.app.locals.broadcast, serverId).catch(e => console.error('[speedtest/manual]', e.message)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/reports/speedtest/vpn — trigger a manual VPN speed test
router.post('/speedtest/vpn', async (req, res) => {
  try {
    const vpnIface = loadConfig()?.network?.vpn_interface ?? null
    if (!vpnIface) {
      return res.status(400).json({ error: 'No VPN interface configured — set vpn_interface in Settings → Network.' })
    }
    if (!isInterfaceUp(vpnIface)) {
      return res.status(400).json({ error: `VPN interface ${vpnIface} is not up — is the VPN connected?` })
    }
    const serverId = req.query.server_id ?? req.body?.server_id ?? null
    res.json({ ok: true, message: 'VPN speed test started' })
    setImmediate(() => runVpnSpeedTest(req.app.locals.broadcast, serverId).catch(e => console.error('[speedtest/vpn]', e.message)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/ookla/servers — discover nearby Ookla servers (returns JSON)
router.get('/ookla/servers', async (req, res) => {
  try {
    // Prefer machine-local Ookla CLI which supports JSON output
    // Try a JSON-enabled listing first; fall back to human list if not supported
    try {
      const iface = req.query.interface ? `--interface ${req.query.interface}` : ''
      const cmd = `speedtest ${iface} --accept-license --accept-gdpr --servers --format=json`
      const result = await exec(cmd, { timeout: 20000 })
      const stdout = typeof result === 'string' ? result : (result && result.stdout) || ''
      const data = JSON.parse(stdout)
      // Expecting an array of servers (provider may differ); normalize shape
      const raw = Array.isArray(data) ? data : (data.servers || [])
      const servers = raw.map(s => {
        const id = s.id ?? s.serverId ?? s.server_id ?? s.server ?? null
        const name = s.name || s.server || s.sponsor || ''
        const country = s.country || s.location || ''
        const city = s.city || ''
        const host = s.host || null
        const distance_km = s.distance_km ?? s.distance ?? null
        return { id, name, country, city, host, distance_km }
      })
      return res.json({ servers })
    } catch {
      // If JSON mode unsupported, attempt to call plain list and parse basic lines
      const result2 = await exec('speedtest --list 2>&1 || speedtest -L 2>&1', { timeout: 20000 })
      const stdout2 = typeof result2 === 'string' ? result2 : (result2 && result2.stdout) || ''
      const lines = (stdout2 || '').split('\n').map(l => l.trim()).filter(Boolean)
      const servers = []
      for (const line of lines) {
        // Typical line: '12345) Example ISP (City, Country) [host:port]'
        const m = line.match(/^([0-9]+)\)\s+(.+?)\s+\(([^)]+)\)/)
        if (m) {
          servers.push({ id: m[1], name: m[2].trim(), location: m[3].trim() })
        }
      }
      if (servers.length === 0) return res.status(502).json({ error: 'Ookla CLI did not return a parsable server list' })
      return res.json({ servers })
    }
  } catch (err) {
    if (/not found|No such file|not recognized/i.test(err.message)) return res.status(503).json({ error: 'Ookla speedtest CLI not installed on this host' })
    return res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/ookla/servers-local — discovery allowed only from localhost
// This is intended for the UI to call via the backend (server will call speedtest
// locally) without exposing discovery to remote clients.
router.get('/ookla/servers-local', async (req, res) => {
  try {
    const remote = req.ip || req.connection?.remoteAddress || ''
    // Allow only localhost addresses
    const ok = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
    if (!ok) return res.status(403).json({ error: 'Forbidden: discovery allowed from localhost only' })

    try {
      const iface = req.query.interface ? `--interface ${req.query.interface}` : ''
      const cmd = `speedtest ${iface} --accept-license --accept-gdpr --servers --format=json`
      const { stdout } = await exec(cmd, { timeout: 20000 })
      const data = JSON.parse(String(stdout || ''))
      const raw = Array.isArray(data) ? data : (data.servers || [])
      const servers = raw.map(s => {
        const id = s.id ?? s.serverId ?? s.server_id ?? s.server ?? null
        const name = s.name || s.server || s.sponsor || ''
        const country = s.country || s.location || ''
        const city = s.city || ''
        const host = s.host || null
        const distance_km = s.distance_km ?? s.distance ?? null
        return { id, name, country, city, host, distance_km }
      })
      return res.json({ servers })
    } catch {
      const { stdout } = await exec('speedtest --list 2>&1 || speedtest -L 2>&1', { timeout: 20000 })
      const lines = (String(stdout || '')).split('\n').map(l => l.trim()).filter(Boolean)
      const servers = []
      for (const line of lines) {
        const m = line.match(/^([0-9]+)\)\s+(.+?)\s+\(([^)]+)\)/)
        if (m) servers.push({ id: m[1], name: m[2].trim(), location: m[3].trim() })
      }
      if (servers.length === 0) return res.status(502).json({ error: 'Ookla CLI did not return a parsable server list' })
      return res.json({ servers })
    }
  } catch (err) {
    if (/not found|No such file|not recognized/i.test(err.message)) return res.status(503).json({ error: 'Ookla speedtest CLI not installed on this host' })
    return res.status(500).json({ error: err.message })
  }
})

export default router
