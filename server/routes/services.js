import { Router } from 'express'
import { execSync, exec } from 'child_process'
import path from 'path'
import { NodeSSH } from 'node-ssh'
import { loadConfig } from '../config.js'
import { audit, getDb, getVpnState, setVpnState } from '../db.js'
import { isPrivateIP } from '../utils/ip.js'
import { getClientMetaVia } from '../utils/speedtest.js'

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
  // Only log service.check when something is actually down (service.up/down events handle transitions)
  if (downCount > 0) {
    audit('service.check', { up: upCount, down: downCount, total: results.length })
  }

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
let _internetAttempts  = [] // array of attempt arrays for double-check evidence

// Initialize previous internet status from the most-recent persisted check so first real transition is detected
try {
  const last = getDb().get(`SELECT payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts DESC LIMIT 1`)
  if (last && last.payload) {
    try { const p = JSON.parse(last.payload); _prevInternetOk = !!p.ok } catch { _prevInternetOk = null }
  }
  } catch {
  // ignore - DB may not be ready in some test contexts
}
let _vpnUp             = false
let _vpnOk             = null
let _vpnResults        = []
let _vpnMeta           = null   // cached VPN exit-node metadata
let _vpnMetaTs         = 0      // timestamp of last successful meta fetch
const VPN_META_TTL_MS  = 30 * 60 * 1000  // re-fetch at most every 30 min

// Outage-mode: switch to faster polling while internet is down, restore on recovery
let _outageMode         = false
let _outagePollId       = null
let _outageAttemptCount = 0
let _outageCheckSecs    = 10   // overridden by setOutageCheckSeconds() on startup/config-save
let _outageBroadcast    = null
let _outageRepeatMtrId  = null // interval for repeated mtr during an outage
let _outageTs           = null // timestamp the current outage started

export function setOutageCheckSeconds(n) {
  _outageCheckSecs = Math.max(5, Math.min(300, Number.isFinite(n) ? n : 10))
}

/** Run a single mtr snapshot and store it in mtr_snapshots. type = 'baseline' | 'outage_repeat' */
export function runMtrSnapshot(type, outageTsValue = null) {
  const ts = Date.now()
  exec('mtr --report --no-dns --report-cycles 5 8.8.8.8 2>&1', { timeout: 120000 }, (err, stdout) => {
    try {
      getDb().run(
        `INSERT INTO mtr_snapshots (ts, type, outage_ts, output, captured_at) VALUES (?, ?, ?, ?, ?)`,
        [ts, type, outageTsValue, stdout || (err?.message ?? 'mtr unavailable'), Date.now()]
      )
      console.log(`[mtr] Snapshot stored (type=${type})`)
    } catch (e) {
      console.error('[mtr] store failed:', e.message)
    }
  })
}

function _startOutagePoll() {
  if (_outagePollId) return
  _outageAttemptCount = 0
  _outageTs = Date.now()
  console.log(`[internet] Outage mode — polling every ${_outageCheckSecs}s until restored`)
  _outagePollId = setInterval(() => {
    checkConnectivity(_outageBroadcast).catch(() => {})
  }, _outageCheckSecs * 1000)

  // Start repeat-mtr if configured
  const cfg = loadConfig()
  const repeatMin = cfg?.schedule?.mtr_outage_repeat_minutes ?? 15
  if (repeatMin > 0) {
    const repeatMs = repeatMin * 60 * 1000
    console.log(`[mtr] Outage repeat — running every ${repeatMin}min while down`)
    _outageRepeatMtrId = setInterval(() => {
      runMtrSnapshot('outage_repeat', _outageTs)
    }, repeatMs)
  }
}

function _stopOutagePoll() {
  if (_outagePollId) {
    clearInterval(_outagePollId)
    _outagePollId = null
    console.log(`[internet] Restored — outage poll stopped after ${_outageAttemptCount} fast attempts`)
  }
  if (_outageRepeatMtrId) {
    clearInterval(_outageRepeatMtrId)
    _outageRepeatMtrId = null
  }
  _outageMode         = false
  _outageAttemptCount = 0
  _outageTs           = null
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

/** Ping a host bound to a specific network interface (Linux only) */
function pingHostVia(host, iface) {
  return new Promise(resolve => {
    const start = Date.now()
    exec(`ping -c 1 -W 3 -I ${iface} ${host}`, { timeout: 5000 }, (err) => {
      resolve({ host, ok: !err, ms: Date.now() - start, ts: Date.now() })
    })
  })
}

/** Returns true if a network interface is UP (Linux/Docker only) */
function isInterfaceUp(iface) {
  if (process.platform === 'win32') return false
  try {
    const out = execSync(`ip link show ${iface} 2>/dev/null`, { timeout: 1000 }).toString()
    return out.length > 0 && /<[^>]*\bUP\b[^>]*>/.test(out)
  } catch { return false }
}

/** Detect the physical (non-VPN) interface to use for direct pings when VPN hijacks the default route */
function detectPhysicalInterface(vpnIface) {
  if (process.platform === 'win32') return null
  try {
    const out = execSync('ip link show', { timeout: 2000 }).toString()
    const candidates = []
    for (const match of out.matchAll(/^\d+:\s+(\S+?)(@\S+)?:\s+<([^>]+)>/gm)) {
      const name  = match[1]
      const flags = match[3]
      if (name === 'lo') continue
      if (name === vpnIface) continue
      if (/^(tun|tap|wg|ppp|veth|docker|br-|virbr|dummy)/.test(name)) continue
      if (!flags.includes('UP')) continue
      candidates.push(name)
    }
    // Prefer the one that carries the default route
    try {
      const routeOut = execSync('ip route show default', { timeout: 2000 }).toString()
      for (const c of candidates) {
        if (routeOut.includes(`dev ${c}`)) return c
      }
    } catch { /* ignore */ }
    return candidates[0] ?? null
  } catch { return null }
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

/** HTTP HEAD check bound to a specific network interface (Linux only, via curl) */
function checkHttpHeadVia(url, iface) {
  const start = Date.now()
  return new Promise(resolve => {
    exec(
      `curl --interface ${iface} -s -o /dev/null -w "%{http_code}" --max-time 5 -X HEAD "${url}"`,
      { timeout: 8000 },
      (err, stdout) => {
        const status = parseInt(stdout?.trim())
        resolve({ host: url, ok: !err && status > 0 && status < 500, ms: Date.now() - start, ts: Date.now() })
      }
    )
  })
}

export async function checkConnectivity(broadcast) {
  // Keep a broadcast ref so the outage poll can broadcast without an argument
  if (broadcast) _outageBroadcast = broadcast

  const cfg = loadConfig()
  const pingHosts = cfg?.network?.connectivity_hosts ?? ['1.1.1.1']

  // VPN check — detect early so we can bind direct pings to the physical interface
  const VPN_IFACE = cfg?.network?.vpn_interface ?? null
  _vpnUp = !!VPN_IFACE && isInterfaceUp(VPN_IFACE)

  // If VPN is hijacking the default route, bind direct pings to the physical interface
  const physIface = _vpnUp ? detectPhysicalInterface(VPN_IFACE) : null
  if (_vpnUp && physIface) {
    console.log(`[internet] VPN (${VPN_IFACE}) active — binding direct pings to ${physIface}`)
  }

  // First attempt
  const attempt1Ping = await Promise.all(pingHosts.map(h => physIface ? pingHostVia(h, physIface) : pingHost(h)))
  const attempt1Http  = physIface
    ? await checkHttpHeadVia('http://connectivity-check.ubuntu.com', physIface)
    : await checkHttpHead('http://connectivity-check.ubuntu.com')
  const attempt1 = [...attempt1Ping, attempt1Http]

  // Double-check attempts (configurable)
  const doubleCheckAttempts = Number(cfg?.schedule?.outage_double_check_attempts ?? 2)
  const doubleCheckInterval = Number(cfg?.schedule?.outage_double_check_interval_seconds ?? 30)
  const attempts = [attempt1]

  if (!attempt1.some(r => r.ok) && doubleCheckAttempts > 1) {
    for (let i = 1; i < doubleCheckAttempts; i++) {
      // wait configured interval (bounded)
      const waitMs = Math.max(1000, Math.min(60000, doubleCheckInterval * 1000))
      await new Promise(r => setTimeout(r, waitMs))
      const p = await Promise.all(pingHosts.map(h => physIface ? pingHostVia(h, physIface) : pingHost(h)))
      const hres = physIface
        ? await checkHttpHeadVia('http://connectivity-check.ubuntu.com', physIface)
        : await checkHttpHead('http://connectivity-check.ubuntu.com')
      attempts.push([...p, hres])
    }
  }

  // Merge last attempt into canonical results for callers; keep attempts for evidence
  _internetAttempts = attempts
  _internetResults  = attempts[attempts.length - 1]
  const ok = attempts.some(at => at.some(r => r.ok))

  if (_vpnUp) {
    _vpnResults = await Promise.all(pingHosts.map(h => pingHostVia(h, VPN_IFACE)))
    _vpnOk = _vpnResults.some(r => r.ok)

    // Fetch VPN exit-node metadata (ISP, exit IP, city) — rate-limited to once per 30 min
    const now = Date.now()
    if (!_vpnMeta || (now - _vpnMetaTs) > VPN_META_TTL_MS) {
      try {
        const meta = await getClientMetaVia(VPN_IFACE)
        if (meta?.client_ip) {
          _vpnMeta = { iface: VPN_IFACE, ...meta, updated_at: now }
          _vpnMetaTs = now
          setVpnState(_vpnMeta)
        }
      } catch (e) {
        console.warn('[internet] VPN meta fetch failed:', e.message)
      }
    }
  } else {
    _vpnResults = []
    _vpnOk = null
    // If VPN just went down, keep last known meta but clear in-memory so next up triggers a fresh fetch
    _vpnMetaTs = 0
  }

  // Gateway check for infra vs ISP vs internal failure classification
  const gateway    = detectGateway()
  const gwResult   = (gateway && !ok) ? await pingHost(gateway) : null
  const gatewayOk  = gwResult ? gwResult.ok : null

  // Determine if failures are internal (LAN-only) by checking failed ping hosts
  const attemptPing = await Promise.all(pingHosts.map(h => pingHost(h)))
  const failedPrivate = attemptPing.filter(p => !p.ok && isPrivateIP(p.host))

  // outageType precedence: null (ok) -> internal -> isp -> infra -> unknown
  let outageType = null
  if (!ok) {
    if (failedPrivate.length > 0 && gatewayOk === true) outageType = 'internal'
    else if (gatewayOk === true) outageType = 'isp'
    else if (gatewayOk === false) outageType = 'infra'
    else outageType = 'unknown'
  }

  // Track attempt count while in outage mode
  if (_outageMode) _outageAttemptCount++

  const justWentDown = ok === false && !_outageMode
  const justCameUp   = ok === true  && _outageMode

  if (_prevInternetOk !== null && _prevInternetOk !== ok) {
    const nowTs = Date.now()
    audit(ok ? 'internet.up' : 'internet.down', {
      results:     _internetResults.map(r => ({ host: r.host, ok: r.ok, ms: r.ms })),
      attempt_count: attempts.length,
      attempts:     attempts.map(a => a.map(r => ({ host: r.host, ok: r.ok, ms: r.ms }))),
      outage_type: ok ? null : outageType,
      gateway_ok:  ok ? null : gatewayOk,
    })
    // Capture diagnostics in the background when going down (traceroute takes time)
    if (!ok) {
      const outageTsCapture = nowTs
        const pingDetail      = _internetResults.map(r => ({ host: r.host, ok: r.ok, ms: r.ms }))
        const gatewayCapture  = gateway ?? null
        const typeCapture     = outageType
        // pingHosts are available via config; ping_detail stores per-host results
      exec('mtr --report --no-dns --report-cycles 5 8.8.8.8 2>&1', { timeout: 120000 }, (err, stdout) => {
        try {
          getDb().run(
            `INSERT OR REPLACE INTO outage_diagnostics (outage_ts, traceroute, ping_detail, gateway, outage_type, captured_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
              [outageTsCapture, stdout || (err?.message ?? 'traceroute unavailable'),
               JSON.stringify(pingDetail), gatewayCapture, typeCapture, Date.now()]
          )
        } catch (e) {
          console.error('[outage-diag] store failed:', e.message)
        }
      })
      // Also attempt to import any external evidence files configured in `pis.external_paths`
      try {
        const db = getDb()
        const pis = db.all('SELECT id, external_paths, retention_days FROM pis')
        const evDir = path.join(__dirname, '..', 'data', 'evidence')
        if (!fs.existsSync(evDir)) fs.mkdirSync(evDir, { recursive: true })
        for (const p of pis) {
          let paths = []
          try { paths = JSON.parse(p.external_paths || '[]') } catch { paths = [] }
          for (const src of paths) {
            try {
              if (!fs.existsSync(src)) continue
              const base = path.basename(src)
              const dest = path.join(evDir, `${outageTsCapture}_${Date.now()}_${base}`)
              try { fs.copyFileSync(src, dest) } catch { continue }
              db.run('INSERT INTO evidence_files (outage_ts, filename, path, uploaded_at) VALUES (?, ?, ?, ?)', [outageTsCapture, base, dest, Date.now()])
            } catch (e) { console.warn('[evidence-import] failed', e.message) }
          }
        }
      } catch (e) { console.warn('[evidence-import] failed', e.message) }
    }
  }

  audit('internet.check', {
    ok,
    results:          _internetResults.map(r => ({ host: r.host, ok: r.ok, ms: r.ms })),
    attempts:         _internetAttempts.map(a => a.map(r => ({ host: r.host, ok: r.ok, ms: r.ms }))),
    outage_type:      ok ? null : outageType,
    gateway_ok:       ok ? null : gatewayOk,
    gateway:          gateway ?? null,
    outage_mode:      _outageMode,
    interval_seconds: _outageMode ? _outageCheckSecs : null,
    attempt_count:    _outageMode ? _outageAttemptCount : null,
    vpn_up:           _vpnUp,
    vpn_ok:           _vpnOk,
    vpn_results:      _vpnResults.map(r => ({ host: r.host, ok: r.ok, ms: r.ms })),
  })

  _prevInternetOk = ok

  // Start / stop fast outage polling
  if (justWentDown) {
    _outageMode = true
    _startOutagePoll()
  } else if (justCameUp) {
    _stopOutagePoll()
  }

  if (broadcast) broadcast('internet', { results: _internetResults, attempts: _internetAttempts, ok, vpn_up: _vpnUp, vpn_ok: _vpnOk, vpn_results: _vpnResults, vpn_meta: _vpnMeta, ts: Date.now() })
  if (broadcast) broadcast('job_done', { job: 'internet', ts: Date.now() })
  return _internetResults
}

export function getInternetStatus() {
  return {
    results:  _internetResults,
    attempts: _internetAttempts,
    ok:       _internetResults.length ? _internetResults.some(r => r.ok) : null,
    vpn_up:   _vpnUp,
    vpn_ok:   _vpnOk,
    vpn_results: _vpnResults,
    vpn_meta: _vpnMeta,
  }
}

router.get('/internet', async (req, res) => {
  try {
    const results = await checkConnectivity(null)
    res.json({ results, attempts: _internetAttempts, ok: results.some(r => r.ok), vpn_up: _vpnUp, vpn_ok: _vpnOk, vpn_meta: _vpnMeta, ts: Date.now() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/vpn-meta', (req, res) => {
  // Return in-memory cache; if not populated yet, try the DB (e.g. after a server restart)
  if (!_vpnMeta) {
    _vpnMeta = getVpnState()
  }
  res.json(_vpnMeta ?? null)
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
