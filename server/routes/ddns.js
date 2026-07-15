import { Router } from 'express'
import { readDdnsStatus, writeDdnsStatus, readDdnsHistory, checkAndUpdateDdns, scanPorts } from '../utils/ddns.js'
import { loadConfig } from '../config.js'
import { audit } from '../db.js'

const router = Router()

// GET /api/ddns/status — current IP, last update time, last error; non-sensitive config metadata
router.get('/status', (req, res) => {
  const cfg    = loadConfig()
  const status = readDdnsStatus()
  const ddns   = cfg?.ddns ?? {}
  const p      = ddns.provider

  // Derive the display hostname without exposing credentials
  let hostname = null
  if (p && ddns[p]) {
    const pc = ddns[p]
    if (p === 'duckdns')   hostname = pc.domains ? `${pc.domains}.duckdns.org` : null
    else if (p === 'afraid') hostname = '(direct URL)'
    else                   hostname = pc.hostname ?? null
  }

  res.json({
    enabled:  ddns.enabled  ?? false,
    provider: p             ?? null,
    interval: ddns.check_interval_minutes ?? 15,
    hostname,
    ...status,
  })
})

// POST /api/ddns/update — force an immediate IP check + update
router.post('/update', async (req, res) => {
  const cfg = loadConfig()
  if (!cfg?.ddns?.enabled) return res.status(400).json({ error: 'DDNS is not enabled' })
  try {
    await checkAndUpdateDdns(cfg, { force: true, triggeredBy: req.user?.username ?? 'user' })
    audit('ddns.force_update', {}, 'user', req.ip)
    res.json({ ok: true, status: readDdnsStatus() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ddns/history — IP change + update event log (newest first, max 200)
router.get('/history', (req, res) => {
  res.json(readDdnsHistory())
})

// POST /api/ddns/portscan — trigger an on-demand port scan of the current public IP
router.post('/portscan', async (req, res) => {
  const cfg    = loadConfig()
  const status = readDdnsStatus()
  const ip     = status?.last_ip
  if (!ip) return res.status(400).json({ error: 'No public IP known yet — run a DDNS check first' })
  try {
    const ports = cfg?.ddns?.port_check_ports ?? undefined
    const scan  = await scanPorts(ip, ports)
    writeDdnsStatus({ ...status, port_scan: scan })
    audit(
      'ddns.port_scan',
      { ip, open: scan.results.filter(r => r.open).map(r => ({ port: r.port, protocol: r.protocol ?? 'tcp' })) },
      req.user?.username ?? 'user',
      req.ip,
    )
    res.json(scan)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
