import { Router } from 'express'
import { execSync, exec } from 'child_process'
import { NodeSSH } from 'node-ssh'
import { loadConfig } from '../config.js'
import { audit } from '../db.js'

const router = Router()

// In-memory history: Map<serviceName, {ok, ms, ts}[]>
const history = new Map()
const MAX_HISTORY = 60
// Previous status for change detection
const _prevStatus = new Map()

function addToHistory(name, entry) {
  if (!history.has(name)) history.set(name, [])
  const arr = history.get(name)
  arr.push(entry)
  if (arr.length > MAX_HISTORY) arr.shift()
}

async function checkHttp(service) {
  const { name, url, expect_status = 200 } = service
  const start = Date.now()
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })
    const ms = Date.now() - start
    const ok = res.status === expect_status
    return {
      name,
      ok,
      message: ok ? `HTTP ${res.status}` : `Expected ${expect_status}, got ${res.status}`,
      ms,
      ts: Date.now(),
    }
  } catch (err) {
    return {
      name,
      ok: false,
      message: err.code === 'ABORT_ERR' || err.name === 'TimeoutError' ? 'Timed out' : err.message,
      ms: Date.now() - start,
      ts: Date.now(),
    }
  }
}

async function checkDocker(service) {
  loadConfig()
  const { name, container } = service
  const start = Date.now()

  // Try local docker first (if server runs on the Pi)
  try {
    const out = execSync(
      `docker inspect -f "{{.State.Running}}" ${container} 2>/dev/null`,
      { timeout: 5000 }
    ).toString().trim()
    const ms = Date.now() - start
    const running = out === 'true'
    return { name, ok: running, message: running ? 'Container running' : 'Container stopped', ms, ts: Date.now() }
  } catch {
    // Fall through to SSH
  }

  // SSH fallback (for remote server or Windows dev machine)
  const cfg2 = loadConfig()
  if (!cfg2?.pi?.host) {
    return { name, ok: false, message: 'No Pi host configured', ms: Date.now() - start, ts: Date.now() }
  }
  if (!cfg2?.pi?.ssh_key) {
    return { name, ok: false, message: 'No SSH key configured — add ssh_key path in Settings', ms: Date.now() - start, ts: Date.now() }
  }
  try {
    const ssh = new NodeSSH()
    const connectOpts = {
      host: cfg2.pi.host,
      username: cfg2.pi.ssh_user,
      readyTimeout: 10000,
      privateKeyPath: cfg2.pi.ssh_key,
    }

    await ssh.connect(connectOpts)
    const result = await ssh.execCommand(
      `docker inspect -f "{{.State.Running}}" ${container} 2>/dev/null`
    )
    ssh.dispose()
    const ms = Date.now() - start
    const running = result.stdout.trim() === 'true'
    return { name, ok: running, message: running ? 'Container running' : 'Container stopped', ms, ts: Date.now() }
  } catch (err) {
    return { name, ok: false, message: `SSH error: ${err.message}`, ms: Date.now() - start, ts: Date.now() }
  }
}

export async function runChecks(broadcast) {
  const cfg = loadConfig()
  const services = cfg?.services ?? []

  const results = await Promise.all(
    services.map(svc => {
      const type = svc.type || 'http'
      return type === 'docker' ? checkDocker(svc) : checkHttp(svc)
    })
  )

  for (const r of results) {
    addToHistory(r.name, { ok: r.ok, ms: r.ms ?? 0, ts: r.ts })
    // Audit status changes
    const prev = _prevStatus.get(r.name)
    if (prev !== undefined && prev !== r.ok) {
      audit(r.ok ? 'service.up' : 'service.down', { name: r.name, message: r.message })
    }
    _prevStatus.set(r.name, r.ok)
  }

  const upCount   = results.filter(r => r.ok).length
  const downCount = results.filter(r => !r.ok).length
  audit('service.check', { up: upCount, down: downCount, total: results.length })

  if (broadcast) broadcast('services', { results, ts: Date.now() })
  if (broadcast) broadcast('job_done', { job: 'services', ts: Date.now() })
  return results
}

export function getHistory() {
  return Object.fromEntries(history)
}

// ── Internet connectivity check ───────────────────────────────────────────────

let _prevInternetOk    = null
let _internetResults   = []

// Outage-mode: switch to faster polling while internet is down, restore on recovery
let _outageMode         = false
let _outagePollId       = null
let _outageAttemptCount = 0
let _outageCheckSecs    = 10   // overridden by setOutageCheckSeconds() on startup/config-save
let _outageBroadcast    = null

export function setOutageCheckSeconds(n) {
  _outageCheckSecs = Math.max(5, Math.min(300, Number.isFinite(n) ? n : 10))
}

function _startOutagePoll() {
  if (_outagePollId) return
  _outageAttemptCount = 0
  console.log(`[internet] Outage mode — polling every ${_outageCheckSecs}s until restored`)
  _outagePollId = setInterval(() => {
    checkConnectivity(_outageBroadcast).catch(() => {})
  }, _outageCheckSecs * 1000)
}

function _stopOutagePoll() {
  if (_outagePollId) {
    clearInterval(_outagePollId)
    _outagePollId = null
    console.log(`[internet] Restored — outage poll stopped after ${_outageAttemptCount} fast attempts`)
  }
  _outageMode         = false
  _outageAttemptCount = 0
}

function pingHost(host) {
  return new Promise(resolve => {
    const start = Date.now()
    const isWin = process.platform === 'win32'
    const cmd = isWin ? `ping -n 1 -w 3000 ${host}` : `ping -c 1 -W 3 ${host}`
    exec(cmd, { timeout: 5000 }, (err) => {
      resolve({ host, ok: !err, ms: Date.now() - start, ts: Date.now() })
    })
  })
}

// Detect the default gateway IP (Linux/Docker only, cached per process lifetime)
let _cachedGateway = undefined
function detectGateway() {
  if (_cachedGateway !== undefined) return _cachedGateway
  if (process.platform === 'win32') { _cachedGateway = null; return null }
  try {
    const out = execSync(
      "ip route show default 2>/dev/null | awk '/default/ { print $3 }' | head -1",
      { timeout: 2000 }
    ).toString().trim()
    _cachedGateway = /^(\d{1,3}\.){3}\d{1,3}$/.test(out) ? out : null
  } catch { _cachedGateway = null }
  return _cachedGateway
}

async function checkHttpHead(url) {
  const start = Date.now()
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    return { host: url, ok: res.status < 500, ms: Date.now() - start, ts: Date.now() }
  } catch {
    return { host: url, ok: false, ms: Date.now() - start, ts: Date.now() }
  }
}

export async function checkConnectivity(broadcast) {
  // Keep a broadcast ref so the outage poll can broadcast without an argument
  if (broadcast) _outageBroadcast = broadcast

  const cfg = loadConfig()
  const pingHosts = cfg?.network?.connectivity_hosts ?? ['1.1.1.1']

  const pingResults = await Promise.all(pingHosts.map(pingHost))
  const httpResult  = await checkHttpHead('http://connectivity-check.ubuntu.com')
  _internetResults  = [...pingResults, httpResult]

  const ok = _internetResults.some(r => r.ok)

  // Gateway check for infra vs ISP failure classification
  const gateway    = detectGateway()
  const gwResult   = (gateway && !ok) ? await pingHost(gateway) : null
  const gatewayOk  = gwResult ? gwResult.ok : null
  // isp = external down but local gateway reachable; infra = gateway also unreachable
  const outageType = ok ? null
    : (gatewayOk === true  ? 'isp'
    :  gatewayOk === false ? 'infra'
    :  'unknown')

  // Track attempt count while in outage mode
  if (_outageMode) _outageAttemptCount++

  const justWentDown = ok === false && !_outageMode
  const justCameUp   = ok === true  && _outageMode

  if (_prevInternetOk !== null && _prevInternetOk !== ok) {
    audit(ok ? 'internet.up' : 'internet.down', {
      results:     _internetResults.map(r => ({ host: r.host, ok: r.ok, ms: r.ms })),
      outage_type: ok ? null : outageType,
      gateway_ok:  ok ? null : gatewayOk,
    })
  }

  audit('internet.check', {
    ok,
    results:          _internetResults.map(r => ({ host: r.host, ok: r.ok, ms: r.ms })),
    outage_type:      ok ? null : outageType,
    gateway_ok:       ok ? null : gatewayOk,
    outage_mode:      _outageMode,
    interval_seconds: _outageMode ? _outageCheckSecs : null,
    attempt_count:    _outageMode ? _outageAttemptCount : null,
  })

  _prevInternetOk = ok

  // Start / stop fast outage polling
  if (justWentDown) {
    _outageMode = true
    _startOutagePoll()
  } else if (justCameUp) {
    _stopOutagePoll()
  }

  if (broadcast) broadcast('internet', { results: _internetResults, ok, ts: Date.now() })
  if (broadcast) broadcast('job_done', { job: 'internet', ts: Date.now() })
  return _internetResults
}

export function getInternetStatus() {
  return { results: _internetResults, ok: _internetResults.length ? _internetResults.some(r => r.ok) : null }
}

router.get('/internet', async (req, res) => {
  try {
    const results = await checkConnectivity(null)
    res.json({ results, ok: results.some(r => r.ok), ts: Date.now() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/run', (req, res) => {
  const bcast = req.app.locals.broadcast
  setImmediate(() => runChecks(bcast).catch(e => console.error('[services] run:', e.message)))
  res.json({ started: true })
})

router.post('/internet/run', (req, res) => {
  const bcast = req.app.locals.broadcast
  setImmediate(() => checkConnectivity(bcast).catch(e => console.error('[internet] run:', e.message)))
  res.json({ started: true })
})

router.get('/', async (req, res) => {
  try {
    const results = await runChecks(null)
    res.json({ results, history: getHistory(), ts: Date.now() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/history', (req, res) => {
  res.json(getHistory())
})

export default router
