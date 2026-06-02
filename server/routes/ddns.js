import { Router } from 'express'
import { readDdnsStatus, readDdnsHistory, checkAndUpdateDdns } from '../utils/ddns.js'
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
    await checkAndUpdateDdns(cfg, { force: true })
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

export default router
