import { Router } from 'express'
import { exec } from 'child_process'
import { getDb } from '../db.js'
import { runSpeedTest, runVpnSpeedTest, getSpeedTestHistory, isInterfaceUp } from '../utils/speedtest.js'
import { loadConfig } from '../config.js'

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

    // Internet connectivity — at most 300 samples for charting
    const netRows = db.all(`SELECT ts, payload FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check' ORDER BY ts ASC LIMIT 300`, [from, to])
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
    const { total_checks: totalChecks, ok_checks: okChecks } = db.get(
      `SELECT COUNT(*) AS total_checks, SUM(CASE WHEN json_extract(payload,'$.ok') = 1 THEN 1 ELSE 0 END) AS ok_checks FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check'`,
      [from, to]
    )
    const uptime = totalChecks > 0 ? parseFloat(((okChecks / totalChecks) * 100).toFixed(3)) : 0
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

    // Pull ALL down/up transitions (not windowed) so we can pair them correctly
    const events = db.all(
      `SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`
    )

    const outages = []
    let downTs       = null
    let downType     = null  // outage_type from the internet.down event
    let lastUpTs     = null  // timestamp of last internet.up (or null = never seen one)
    for (const e of events) {
      if (e.event === 'internet.down' && downTs === null) {
        downTs   = e.ts
        try { const p = JSON.parse(e.payload); downType = p.outage_type ?? null } catch { downType = null }
      } else if (e.event === 'internet.up' && downTs !== null) {
        const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
        outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs, outage_type: downType, ongoing: false })
        lastUpTs = e.ts
        downTs   = null
        downType = null
      } else if (e.event === 'internet.up') {
        lastUpTs = e.ts
      }
    }
    // Still offline?
    if (downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, uptimeBeforeMs, outage_type: downType, ongoing: true })
    }

    // Filter to outages that overlap the requested window — newest first
    const windowed = outages.filter(o => (!o.end || o.end >= from) && o.start <= to).reverse()
    const totalDowntimeMs = windowed.reduce((s, o) => s + o.durationMs, 0)
    const longestMs = windowed.length ? Math.max(...windowed.map(o => o.durationMs)) : 0

    // Attach stored diagnostics (traceroute + ping detail) if available
    const diagRows = db.all(`SELECT outage_ts, traceroute, ping_detail, gateway, captured_at FROM outage_diagnostics`)
    const diagMap  = new Map(diagRows.map(r => [r.outage_ts, r]))
    const windowedWithDiag = windowed.map(o => {
      const d = diagMap.get(o.start)
      if (!d) return o
      let pingDetail = null
      try { pingDetail = JSON.parse(d.ping_detail) } catch {}
      return { ...o, diagnostics: { traceroute: d.traceroute, ping_detail: pingDetail, gateway: d.gateway, captured_at: d.captured_at } }
    })

    res.json({
      outages: windowedWithDiag,
      totalOutages: windowed.length,
      totalDowntimeMs,
      longestMs,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/reports/outages/:ts — diagnostics for a specific outage (by start timestamp)
router.get('/outages/:ts', (req, res) => {
  try {
    const ts = parseInt(req.params.ts)
    if (!ts) return res.status(400).json({ error: 'invalid ts' })
    const row = getDb().get(
      `SELECT outage_ts, traceroute, ping_detail, gateway, outage_type, captured_at FROM outage_diagnostics WHERE outage_ts = ?`,
      [ts]
    )
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
    res.json({ ok: true, message: 'Direct speed test started' })
    setImmediate(() => runSpeedTest(req.app.locals.broadcast).catch(e => console.error('[speedtest/manual]', e.message)))
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
    res.json({ ok: true, message: 'VPN speed test started' })
    setImmediate(() => runVpnSpeedTest(req.app.locals.broadcast).catch(e => console.error('[speedtest/vpn]', e.message)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
