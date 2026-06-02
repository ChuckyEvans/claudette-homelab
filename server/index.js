import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cron from 'node-cron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { loadConfig } from './config.js'
import servicesRouter, { runChecks, checkConnectivity, setOutageCheckSeconds, runMtrSnapshot } from './routes/services.js'
import { runSpeedTest } from './utils/speedtest.js'
import threatsRouter, { refreshThreats } from './routes/threats.js'
import networkRouter, { setBroadcast, runPingSweep, runScheduledDeepScan, startBackgroundArpSniffer, startMdnsSniffer } from './routes/network.js'
import systemRouter from './routes/system.js'
import { doAutoBackup } from './routes/system.js'
import configRouter from './routes/config.js'
import auditRouter from './routes/audit.js'
import reportsRouter from './routes/reports.js'
import authRouter from './routes/auth.js'
import themesRouter from './routes/themes.js'
import ddnsRouter from './routes/ddns.js'
import { checkAndUpdateDdns } from './utils/ddns.js'
import { pruneOldData, getDataDir } from './db.js'
import { requireAuth } from './middleware/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 7654

app.use(cors({ origin: true, credentials: true }))
app.use(cookieParser())
app.use(express.json())

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
}))

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

// All other /api routes require a valid session
app.use('/api', requireAuth)

app.use('/api/services', servicesRouter)
app.use('/api/threats', threatsRouter)
app.use('/api/network', networkRouter)
app.use('/api/system', systemRouter)
app.use('/api/config', configRouter)
app.use('/api/audit', auditRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/themes', themesRouter)
app.use('/api/ddns', ddnsRouter)

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
  const speedtestHr = cfg?.schedule?.speedtest_interval_hours ?? 1
  const threatHr    = cfg?.schedule?.threat_interval_hours    ?? 6
  const deepHour    = cfg?.schedule?.deep_scan_hour           ?? 4
  const backupDays  = cfg?.schedule?.backup_interval_days     ?? 0
  const retainDays  = cfg?.retention?.days                    ?? 90

  console.log(`[jobs] Scheduled: services=${minutesToCron(checkMin)} internet=${minutesToCron(internetMin)} ping=${minutesToCron(pingMin)} speedtest=${hoursToCron(speedtestHr)} threats=${hoursToCron(threatHr)} deep-scan=0 ${deepHour} * * *`)

  _tasks.push(cron.schedule(minutesToCron(checkMin),    () => enqueue('services',  () => runChecks(broadcast))))
  _tasks.push(cron.schedule(minutesToCron(internetMin), () => enqueue('internet',  () => checkConnectivity(broadcast))))
  _tasks.push(cron.schedule(minutesToCron(pingMin),     () => enqueue('ping',      () => runPingSweep(broadcast))))
  _tasks.push(cron.schedule(hoursToCron(speedtestHr),   () => enqueue('speedtest', () => runSpeedTest(broadcast))))
  _tasks.push(cron.schedule(hoursToCron(threatHr),      () => enqueue('threats',   () => refreshThreats(broadcast))))

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

  if (backupDays > 0) {
    _tasks.push(cron.schedule('0 2 * * *', () => {
      if (due('backup', backupDays * 86_400_000)) doAutoBackup()
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

app.listen(PORT, () => {
  console.log(`\n  Claudette UI  →  http://localhost:${PORT}\n`)
})
