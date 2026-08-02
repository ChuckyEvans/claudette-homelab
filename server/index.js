import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cron from 'node-cron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { initLogBuffer } from './utils/logBuffer.js'

// Patch console methods first so startup logs are captured
initLogBuffer()

import { loadConfig } from './config.js'
import { getDb } from './db.js'

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
import servicesRouter, { runChecks, checkConnectivity, setOutageCheckSeconds, runMtrSnapshot } from './routes/services.js'
import { runSpeedTest, runVpnSpeedTest } from './utils/speedtest.js'
import threatsRouter, { refreshThreats } from './routes/threats.js'
import networkRouter, { setBroadcast, runPingSweep, runScheduledDeepScan, startBackgroundArpSniffer, startMdnsSniffer } from './routes/network.js'
import systemRouter from './routes/system.js'
import { doAutoBackup } from './routes/system.js'
import configRouter from './routes/config.js'
import auditRouter from './routes/audit.js'
import reportsRouter from './routes/reports.js'
import { computeOutages } from './lib/outages.mjs'
import paginateRouter from './routes/paginate.js'
import diagnosticsRouter from './routes/diagnostics.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import themesRouter from './routes/themes.js'
import ddnsRouter from './routes/ddns.js'
import logsRouter from './routes/logs.js'
import debugRouter from './routes/debug.js'
import retentionRouter from './routes/retention.js'
import healthRouter from './routes/health.js'
import pisRouter from './routes/pis.js'
import { checkAndUpdateDdns } from './utils/ddns.js'
import { pruneOldData, getDataDir } from './db.js'
import { requireAuth } from './middleware/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 7654

// Trust the first proxy (Nginx) so req.secure reflects HTTPS and rate-limit sees real IPs
app.set('trust proxy', 1)

app.use(cors({ origin: true, credentials: true }))
app.use(cookieParser())
app.use(express.json())

// Ensure COOP / Origin-Agent-Cluster headers are applied uniformly across
// responses to avoid mixed site-keying (some responses requesting origin-
// keying while others do not). Browsers may ignore COOP on insecure origins,
// but having consistent headers prevents the "site-keyed vs origin-keyed"
// mismatch warning.
// Send COOP / Origin-Agent-Cluster headers only for secure or localhost origins.
// Browsers refuse to apply COOP when origin is not potentially trustworthy (HTTP on LAN).
app.use((req, res, next) => {
  try {
    const _host = req.headers.host || ''
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'
    // Only request origin-keying when the request is secure. Avoid setting
    // COOP/OAC on plain HTTP LAN origins (browsers will ignore COOP there
    // and mixed settings can produce warnings about site-keyed clusters).
    if (isSecure) {
      // Request origin-keyed agent cluster
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Origin-Agent-Cluster', '?1')
    }
  } catch { /* ignore */ }
  next()
})

// ── Security headers (OWASP A05 Misconfiguration) ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false, // prevent helmet adding upgrade-insecure-requests (app is HTTP-only)
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc:      ["'self'", "'unsafe-inline'"], // Tailwind + React inline styles
      imgSrc:        ["'self'", "data:", "blob:", "https://picsum.photos"],
      connectSrc:    ["'self'"],
      workerSrc:     ["'self'", "blob:"],  // allow WebRTC worker threads
      fontSrc:       ["'self'", "data:"],
      objectSrc:     ["'none'"],
      frameSrc:      ["'none'"],
      baseUri:       ["'self'"],
      formAction:    ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Don't send HSTS header from an HTTP-only server; enable via proxy (Nginx) when using HTTPS
  hsts: false,
}))

// Ensure COOP/OAC are not sent for insecure (HTTP) LAN origins — some
// browsers treat these as untrustworthy and will ignore or warn when mixed
// site-keying headers are present. This middleware forcibly removes those
// headers unless the request is secure.
app.use((req, res, next) => {
  try {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'
    if (!isSecure) {
      res.removeHeader('Cross-Origin-Opener-Policy')
      res.removeHeader('Origin-Agent-Cluster')
    }
  } catch { /* ignore */ }
  next()
})

// ── Auth rate limiter (OWASP A07 Auth Failures) ──────────────────────────────
const authLimiter = rateLimit({
  windowMs:       15 * 60 * 1000, // 15-minute window
  max:            20,             // 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { error: 'Too many attempts, please try again later' },
})

// ── SSE ──────────────────────────────────────────────────────────────────────
const sseClients = new Set()

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of sseClients) {
    try { res.write(msg) } catch { sseClients.delete(res) }
  }
}

app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)

  sseClients.add(res)

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(keepAlive) }
  }, 20000)

  req.on('close', () => {
    clearInterval(keepAlive)
    sseClients.delete(res)
  })
})

// Give network route a reference to broadcast
setBroadcast(broadcast)

// Expose broadcast to routes via app.locals
app.locals.broadcast = broadcast

// ── Routes ───────────────────────────────────────────────────────────────────
// Auth routes are public — mount before requireAuth
// Rate-limit login + register to block brute-force (OWASP A07)
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/auth', authRouter)

// Temporary top-level debug endpoint for outages — mounted before auth so it
// can be accessed without a session for local debugging. Only enabled for
// private LAN addresses or when ALLOW_UNAUTH_ADMIN=1 is set.
app.get('/api/reports/debug/outages', async (req, res) => {
  try {
    // Temporarily allow access from any IP — this is a short-lived debug aid.
    // Note: remove or harden before using in production.

    const db   = getDb()
    const to   = req.query.to   ? parseInt(req.query.to)   : Date.now()
    const from = req.query.from ? parseInt(req.query.from) : to - SEVEN_DAYS

    // Persisted rows (authoritative)
    let persisted = []
    try {
      persisted = db.all(`SELECT start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM network_outages WHERE start <= ? ORDER BY start ASC`, [to])
    } catch { persisted = [] }

    // Load recent internet.check rows and a paired-from-checks view
    const outagesMod = await import('./lib/outages.mjs')
    const { loadInternetCheckRows, pairOutagesFromChecks } = outagesMod
    const checks = loadInternetCheckRows(db, from, to)
    const pairedFromChecks = pairOutagesFromChecks(checks)

    const windowed = computeOutages(db, from, to)
    const totalDowntimeMs = windowed.reduce((s, o) => s + o.durationMs, 0)
    const longestMs = windowed.length ? Math.max(...windowed.map(o => o.durationMs)) : 0

    res.json({
      outages: windowed,
      totalOutages: windowed.length,
      totalDowntimeMs,
      longestMs,
      from,
      to,
      persisted,        // raw persisted network_outages rows
      checks,           // raw internet.check rows (parsed)
      pairedFromChecks, // pairing result derived from checks
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Discovery endpoint that the frontend calls via the backend. This runs the
// Ookla CLI on the host and returns a JSON-normalized server list. Access is
// protected by `requireAuth` (mounted below) so only authenticated users can
// invoke it.
app.get('/api/reports/ookla/servers-local', async (req, res) => {
  try {
    const iface = req.query.interface ? `--interface ${req.query.interface}` : ''
    const cmd = `speedtest ${iface} --accept-license --accept-gdpr --servers --format=json`
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const pe = promisify(exec)
    try {
      const { stdout } = await pe(cmd, { timeout: 20000 })
      const outStr = String(stdout || '')
      let data
      try {
        data = JSON.parse(outStr)
      } catch {
        console.warn('[ookla] Failed to JSON-parse Ookla stdout; logging raw output')
        console.warn(outStr.slice(0, 2000))
        throw new Error('Could not parse Ookla CLI JSON output')
      }
      const raw = Array.isArray(data) ? data : (data.servers || [])
      const servers = raw.map(s => ({ id: s.id ?? s.serverId ?? s.server_id ?? s.server ?? null, name: s.name || s.server || s.sponsor || '', country: s.country || s.location || '', city: s.city || '', host: s.host || null, distance_km: s.distance_km ?? s.distance ?? null }))
      // Enrich with last-known ping from DB if available
      try {
        const { listOoklaServersWithPing, sortOoklaServers, formatOoklaServerLabel } = await import('./utils/speedtest.js')
        const enriched = await listOoklaServersWithPing(req.query.interface ? req.query.interface : null)
        const map = new Map(enriched.map(s => [String(s.id), s]))
        const out = servers.map(s => {
          const extra = map.get(String(s.id)) ?? {}
          return {
            ...s,
            label: extra.label ?? formatOoklaServerLabel(s),
            last_ping_ms: extra.last_ping_ms ?? null,
          }
        }).sort(sortOoklaServers)
        return res.json({ servers: out })
      } catch {
        return res.json({ servers })
      }
    } catch {
      const { stdout } = await pe('speedtest --list 2>&1 || speedtest -L 2>&1', { timeout: 20000 })
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

// All other /api routes require a valid session
app.use('/api', requireAuth)

app.use('/api/services', servicesRouter)
app.use('/api/threats', threatsRouter)
app.use('/api/network', networkRouter)
app.use('/api/system', systemRouter)
app.use('/api/config', configRouter)
app.use('/api/audit', auditRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/paginate', paginateRouter)
app.use('/api/themes', themesRouter)
app.use('/api/ddns', ddnsRouter)
app.use('/api/logs', logsRouter)
app.use('/api/debug', debugRouter)
app.use('/api/retention', retentionRouter)
app.use('/api/diagnostics', diagnosticsRouter)
app.use('/api/health', healthRouter)
app.use('/api/pis', pisRouter)
app.use('/api/users', usersRouter)

// ── Static (production) ───────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist')
  // Theme photos: serve from data volume first (refreshed copies), fall back to bundled defaults
  app.use('/themes', (req, res, next) => {
    const file = path.basename(req.path) // strip any path traversal
    if (!file || file.includes('..')) return next()
    const dataFile = path.join(getDataDir(), 'themes', file)
    if (fs.existsSync(dataFile)) return res.sendFile(dataFile)
    next()
  })
  // Assets are content-hashed — cache them aggressively; never cache index.html itself
  app.use(express.static(distPath, { index: false }))
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// Temporary debug UI page (development/admin only)
app.get('/debug/outages', (_req, res) => {
  try {
    const file = path.join(__dirname, '..', 'public', 'debug-outages.html')
    if (fs.existsSync(file)) return res.sendFile(file)
    res.status(404).send('debug page missing')
  } catch (e) { res.status(500).send(e.message) }
})

// ── Background jobs ───────────────────────────────────────────────────────────

// Start passive ARP gateway sniffer (low overhead, runs continuously)
setTimeout(() => startBackgroundArpSniffer(), 3000)
// Start passive mDNS sniffer for hostname discovery on subnets without PTR records
setTimeout(() => startMdnsSniffer(), 4000)

// Run once on startup
setTimeout(() => checkAndUpdateDdns(loadConfig()).catch(e => console.error('[jobs] ddns:', e.message)), 8000)
setTimeout(() => runChecks(broadcast).catch(e => console.error('[jobs] check:', e.message)), 2000)
setTimeout(() => checkConnectivity(broadcast).catch(e => console.error('[jobs] internet:', e.message)), 4000)
setTimeout(() => refreshThreats(broadcast).catch(e => console.error('[jobs] threats:', e.message)), 5000)
setTimeout(() => runPingSweep(broadcast).catch(e => console.error('[jobs] ping:', e.message)), 15000)

// On startup, run a quick persist of target and network outages to catch any
// transitions that occurred while the server was offline. This is best-effort
// and idempotent — it will upsert existing rows. Run after other initial jobs.
setTimeout(() => {
  import('./db.js').then(db => {
    try {
      const t = db.persistTargetOutages()
      const n = db.persistOutages()
      if ((n || 0) + (t || 0) > 0) {
        if (app.locals && app.locals.broadcast) app.locals.broadcast('outages.persisted', { count: (n || 0) + (t || 0), ts: Date.now() })
        console.log('[startup] persisted outages on boot ->', { target: t, network: n })
      } else {
        console.log('[startup] no persisted outages needed on boot')
      }
    } catch (e) { console.error('[startup] persist outages failed:', e && e.message) }
  }).catch(e => console.error('[startup] import db failed:', e && e.message))
}, 30000)

// ── Job queue — runs background jobs one at a time, in order ─────────────────
const _jobQueue = []
let _jobRunning = false

function enqueue(name, fn) {
  _jobQueue.push({ name, fn })
  _drain()
}

function _drain() {
  if (_jobRunning || _jobQueue.length === 0) return
  const { name, fn } = _jobQueue.shift()
  _jobRunning = true
  fn()
    .catch(e => console.error(`[jobs] ${name}:`, e.message))
    .finally(() => { _jobRunning = false; _drain() })
}

import { minutesToCron, hoursToCron } from './utils/schedule.js'

// ── Scheduled jobs (recreated on startup and whenever config is saved) ────────
let _tasks = []
const _lastRun = new Map()
function due(key, intervalMs) {
  const now = Date.now()
  if (now - (_lastRun.get(key) ?? 0) >= intervalMs) { _lastRun.set(key, now); return true }
  return false
}

function scheduleJobs() {
  _tasks.forEach(t => t.stop())
  _tasks = []

  const cfg          = loadConfig()
  const checkMin     = cfg?.schedule?.check_interval_minutes   ?? 5
  const internetMin  = cfg?.schedule?.internet_check_minutes   ?? 5
  const outageSecs   = cfg?.schedule?.internet_outage_check_seconds ?? 10
  setOutageCheckSeconds(outageSecs)
  const pingMin     = cfg?.schedule?.ping_interval_minutes    ?? 5
  const speedtestHr    = cfg?.schedule?.speedtest_interval_hours     ?? 1
  const vpnSpeedtestHr  = cfg?.schedule?.vpn_speedtest_interval_hours ?? 6
  const threatHr    = cfg?.schedule?.threat_interval_hours    ?? 6
  const deepHour    = cfg?.schedule?.deep_scan_hour           ?? 4
  const backupDays  = cfg?.schedule?.backup_interval_days     ?? 0
  const retainDays  = cfg?.retention?.days                    ?? 365
  const detectorsMin = cfg?.schedule?.detectors_interval_minutes ?? 5

  console.log(`[jobs] Scheduled: services=${minutesToCron(checkMin)} internet=${minutesToCron(internetMin)} ping=${minutesToCron(pingMin)} speedtest=${hoursToCron(speedtestHr)} threats=${hoursToCron(threatHr)} deep-scan=0 ${deepHour} * * *`)

  _tasks.push(cron.schedule(minutesToCron(checkMin),    () => enqueue('services',  () => runChecks(broadcast))))
  _tasks.push(cron.schedule(minutesToCron(internetMin), () => enqueue('internet',  () => checkConnectivity(broadcast))))
  _tasks.push(cron.schedule(minutesToCron(pingMin),     () => enqueue('ping',      () => runPingSweep(broadcast))))
  _tasks.push(cron.schedule(hoursToCron(speedtestHr),   () => enqueue('speedtest', () => runSpeedTest(broadcast))))

  if (vpnSpeedtestHr > 0) {
    console.log(`[jobs] VPN speedtest every ${vpnSpeedtestHr}h`)
    _tasks.push(cron.schedule(hoursToCron(vpnSpeedtestHr), () => enqueue('vpn-speedtest', () => runVpnSpeedTest(broadcast).catch(() => {}))))
  }
  _tasks.push(cron.schedule(hoursToCron(threatHr),      () => enqueue('threats',   () => refreshThreats(broadcast))))

  // Run detectors persistence on a configurable interval
  if (detectorsMin > 0) {
    console.log(`[jobs] detectors persistence every ${detectorsMin} minutes`)
    _tasks.push(cron.schedule(minutesToCron(detectorsMin), () => enqueue('detectors', async () => {
      try {
        const detectors = await import('./lib/detectors.js')
        if (detectors.persistIpClashes) await detectors.persistIpClashes(200)
        if (detectors.persistMacIpChurn) await detectors.persistMacIpChurn(200)
        if (detectors.persistPortScans) await detectors.persistPortScans(200)
        if (detectors.persistBeacons) await detectors.persistBeacons(200)
          if (detectors.persistAuthFailures) await detectors.persistAuthFailures(200)
          if (detectors.persistThreatMatches) await detectors.persistThreatMatches(200)
          // network checks: ping direct vs tun0 and persist
          try {
            const net = await import('./lib/network-check.js')
            if (net && net.persistNetworkCheck) await net.persistNetworkCheck()
          } catch (e) { console.error('[jobs] network-check:', e.message) }
            // Persist computed outages to DB after network checks
            try {
              const db = await import('./db.js')
              if (db && db.persistOutages) {
                const n = db.persistOutages()
                if (n && app.locals.broadcast) app.locals.broadcast('outages.persisted', { count: n, ts: Date.now() })
              }
            } catch (e) { console.error('[jobs] persist-outages:', e.message) }
      } catch (e) { console.error('[jobs] detectors:', e.message) }
    })))
  }

  // Schedule connectivity script if present at /opt/conn_check.js (container) or server/conn_check.js (local dev)
  try {
    const candidates = ['/opt/conn_check.js', path.join(__dirname, 'conn_check.js')]
    const found = candidates.find(p => fs.existsSync(p))
    if (found) {
      import('util').then(({ promisify }) => {
        import('child_process').then(({ execFile }) => {
          const pe = promisify(execFile)
          _tasks.push(cron.schedule('*/5 * * * *', () => {
            enqueue('conn-check', async () => {
              try {
                // Use execFile with the node executable to avoid shell parsing
                await pe(process.execPath, [found])
              } catch (e) { console.error('[jobs] conn-check:', e && e.message)
              }
            })
          }))
        })
      }).catch(() => { /* ignore on platforms without execFile */ })
    } else {
      console.log('[jobs] conn-check: no conn_check.js found; skipping conn-check job')
    }
  } catch (e) { console.error('[jobs] conn-check-schedule:', e && e.message) }

  // Baseline mtr — runs on a configurable schedule when internet is healthy
  const mtrBaselineHrs = cfg?.schedule?.mtr_baseline_hours ?? 1
  if (mtrBaselineHrs > 0) {
    console.log(`[jobs] Baseline mtr every ${mtrBaselineHrs}h`)
    _tasks.push(cron.schedule(hoursToCron(mtrBaselineHrs), () => {
      runMtrSnapshot('baseline')
    }))
  }

  _tasks.push(cron.schedule(`0 ${deepHour} * * *`, () => {
    console.log(`[jobs] Starting scheduled deep scan (hour=${deepHour})...`)
    enqueue('deep-scan', () => runScheduledDeepScan(broadcast))
  }))

  _tasks.push(cron.schedule('0 3 * * *', () => {
    console.log(`[jobs] Pruning data older than ${retainDays} days...`)
    pruneOldData(retainDays)
  }))

  // Backup 24h before retention_until if configured
  _tasks.push(cron.schedule('0 2 * * *', () => {
    // use dynamic import to access local modules in ESM
    import('./db.js').then(db => {
      try {
        const conn = db.getDb()
        const row = conn.prepare(`SELECT v FROM retention_settings WHERE k = 'retention_until'`).get()
        if (!row || !row.v) return
        const until = new Date(row.v).getTime()
        const now = Date.now()
        const msUntil = until - now
        const oneDay = 24 * 60 * 60 * 1000
        if (msUntil > 0 && msUntil <= oneDay) {
          // Check if we've already created backup for this retention_until
          const existing = conn.prepare(`SELECT v FROM retention_settings WHERE k = 'backup_done_for_until'`).get()
          if (existing && existing.v === row.v) return
          console.log('[jobs] Retention deadline approaching — creating DB backup')
          import('./routes/system.js').then(system => {
            try { system.doAutoBackup() } catch (e) { console.error('[jobs] retention-backup-auto:', e.message) }
          })
          try {
            // notify connected clients that a retention backup was created
            app.locals.broadcast && app.locals.broadcast('retention.backup', { retentionUntil: row.v, ts: Date.now() })
          } catch (e) { console.error('[jobs] retention-sse:', e.message) }
          conn.run(`CREATE TABLE IF NOT EXISTS retention_settings (k TEXT PRIMARY KEY, v TEXT)`)
          conn.run(`INSERT OR REPLACE INTO retention_settings (k,v) VALUES ('backup_done_for_until',?)`, [row.v])
        }
      } catch (e) { console.error('[jobs] retention-backup:', e.message) }
    }).catch(() => { /* ignore if db import fails */ })
  }))

  if (backupDays > 0) {
    _tasks.push(cron.schedule('0 2 * * *', () => {
      if (due('backup', backupDays * 86_400_000)) {
        try {
          doAutoBackup()
          try { app.locals.broadcast && app.locals.broadcast('backup.auto', { ts: Date.now() }) } catch (e) { console.error('[jobs] backup-sse:', e.message) }
        } catch (e) { console.error('[jobs] auto-backup:', e.message) }
      }
    }))
  }

  const ddnsCfg = cfg?.ddns
  if (ddnsCfg?.enabled) {
    const ddnsMin = Math.max(5, ddnsCfg.check_interval_minutes ?? 15)
    console.log(`[jobs] DDNS check: ${minutesToCron(ddnsMin)} (provider=${ddnsCfg.provider})`)
    _tasks.push(cron.schedule(minutesToCron(ddnsMin), () => {
      checkAndUpdateDdns(loadConfig()).catch(e => console.error('[jobs] ddns:', e.message))
    }))
  }
}

scheduleJobs()
app.locals.reschedule = scheduleJobs
// expose last-run map to routes for health checks
app.locals.lastRun = _lastRun

if (!process.env.VITEST) {
  app.listen(PORT, () => {
    console.log(`\n  Claudette UI  →  http://localhost:${PORT}\n`)
  })
}

// Export the app for programmatic access (tests / scripts)
export default app
