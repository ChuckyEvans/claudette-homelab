import { Router } from 'express'
import { getDb } from '../db.js'
import { runSpeedTest, getSpeedTestHistory } from '../utils/speedtest.js'

const router = Router()

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

// ── Event category → which table(s) to query ─────────────────────────────────
// 'device' prefix → device_events only
// 'scan'/'service'/'threat'/'config' → audit_log only
// default (all) → both

function buildDeviceEventsQuery(from, to, eventPrefix, mac, subnetPrefix, limit, offset) {
  const conds = ['ts >= ? AND ts <= ?']
  const params = [from, to]
  if (eventPrefix)   { conds.push('event LIKE ?'); params.push(`${eventPrefix}%`) }
  if (mac)           { conds.push('mac = ?');       params.push(mac) }
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
      // UNION both tables — sort and paginate in JS (fine for home-scale datasets)
      const dq = buildDeviceEventsQuery(from, to, eventFilter, null, subnetPrefix, 10000, 0)
      const aq = buildAuditLogQuery(from, to, eventFilter, 10000, 0)
      const devRows = db.all(dq.rows, dq.params)
      const sysRows = db.all(aq.rows, aq.params)
      allRows = [...devRows, ...sysRows]
        .sort((a, b) => b.ts - a.ts)
        .slice(offset, offset + limit)
      total = db.get(dq.count, dq.params).n + db.get(aq.count, aq.params).n
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

    res.json({
      events: allRows.map(r => ({ ...r, payload: JSON.parse(r.payload) })),
      total,
      limit,
      offset,
      from,
      to,
      summary: { newDevices, onlineEvents, offlineEvents, portFinds, serviceDown, scansRun },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/chart?from=&to= — aggregated data for charts
router.get('/chart', (req, res) => {
  try {
    const db   = getDb()
    const to   = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS

    // Daily device event counts
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
    const daily = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))

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

    // Internet connectivity — at most 300 samples
    const netRows = db.all(`SELECT ts, payload FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check' ORDER BY ts ASC LIMIT 300`, [from, to])
    const internet = netRows.flatMap(r => {
      try {
        const p = JSON.parse(r.payload)
        const ok = (p.results ?? []).filter(x => x.ok && x.ms != null)
        const ms = ok.length ? Math.round(ok.reduce((s, x) => s + x.ms, 0) / ok.length) : null
        return [{ ts: r.ts, ok: p.ok ?? false, ms }]
      } catch { return [] }
    })

    // Internet stats summary: uptime %, avg latency, check count, status changes
    const totalChecks = netRows.length
    const okChecks = netRows.filter(r => {
      try { return (JSON.parse(r.payload).ok ?? false) } catch { return false }
    }).length
    const uptime = totalChecks > 0 ? parseFloat(((okChecks / totalChecks) * 100).toFixed(3)) : 0
    const avgLatency = internet.filter(x => x.ms != null).length > 0
      ? Math.round(internet.filter(x => x.ms != null).reduce((s, x) => s + x.ms, 0) / internet.filter(x => x.ms != null).length)
      : 0
    const changes = internet.reduce((acc, cur, i) => acc + (i > 0 && internet[i-1].ok !== cur.ok ? 1 : 0), 0)

    // Speed test stats summary (for SLA comparison)
    const stRows = db.all(`SELECT download_mbps, upload_mbps FROM speed_tests WHERE ts >= ? AND ts <= ?`, [from, to])
    const speedStats = stRows.length > 0 ? {
      avgDown: parseFloat((stRows.reduce((s, r) => s + (r.download_mbps ?? 0), 0) / stRows.length).toFixed(1)),
      avgUp:   parseFloat((stRows.reduce((s, r) => s + (r.upload_mbps   ?? 0), 0) / stRows.length).toFixed(1)),
    } : null

    res.json({ daily, topPorts, serviceDowns, internet, internetStats: { uptime, avgLatency, totalChecks, changes }, speedStats })
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
        return {
          ts: r.ts,
          ok: p.ok ?? false,
          avgMs,
          hostCount: hosts.length,
          okCount: ok.length,
          hosts,
          outage_mode:      p.outage_mode      ?? false,
          interval_seconds: p.interval_seconds ?? null,
          attempt_count:    p.attempt_count    ?? null,
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

    // Pull ALL down/up transitions (not windowed) so we can pair them correctly
    const events = db.all(
      `SELECT ts, event FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`
    )

    const outages = []
    let downTs  = null
    let lastUpTs = null   // timestamp of last internet.up (or null = never seen one)
    for (const e of events) {
      if (e.event === 'internet.down' && downTs === null) {
        downTs = e.ts
      } else if (e.event === 'internet.up' && downTs !== null) {
        const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
        outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs, ongoing: false })
        lastUpTs = e.ts
        downTs   = null
      } else if (e.event === 'internet.up') {
        lastUpTs = e.ts
      }
    }
    // Still offline?
    if (downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, uptimeBeforeMs, ongoing: true })
    }

    // Filter to outages that overlap the requested window — newest first
    const windowed = outages.filter(o => (!o.end || o.end >= from) && o.start <= to).reverse()
    const totalDowntimeMs = windowed.reduce((s, o) => s + o.durationMs, 0)
    const longestMs = windowed.length ? Math.max(...windowed.map(o => o.durationMs)) : 0

    res.json({
      outages: windowed,
      totalOutages: windowed.length,
      totalDowntimeMs,
      longestMs,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/reports/speedtest — trigger a manual speed test
router.post('/speedtest', async (req, res) => {
  try {
    // Fire-and-forget if broadcast available, but return immediately with an ack
    // The cron broadcast will notify via SSE when done
    res.json({ ok: true, message: 'Speed test started' })
    // Run after response is sent so the HTTP call doesn't time out
    setImmediate(() => runSpeedTest(req.app.locals.broadcast).catch(e => console.error('[speedtest/manual]', e.message)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
