import express from 'express'
import detectors from '../lib/detectors.js'
import alerts from '../lib/alerts.js'

const router = express.Router()

// Incidents endpoint: aggregate a few cheap detectors
router.get('/', async (req, res) => {
  try {
    // Query params for filtering/pagination/sorting
    const { limit = '200', offset = '0', type, sort = 'last_seen', age = '30' } = req.query
    const l = Math.min(1000, Number(limit) || 200)
    const o = Math.max(0, Number(offset) || 0)

    // Run detectors (cheap ones) in parallel
    const [clashes, churn, portScans, beacons] = await Promise.all([
      detectors.detectIpClashes(100),
      detectors.detectMacIpChurn(100),
      detectors.detectPortScans(50),
      detectors.detectBeacons(100),
    ])

    // persisted alerts support basic filtering/sorting/paging
    const persisted = await alerts.listAlerts(l, o, { type, sort, age })
    res.json({ clashes, churn, portScans, beacons, persisted })
  } catch (err) {
    console.error('incidents error', err)
    res.status(500).json({ error: 'internal' })
  }
})

// POST /run - trigger detectors now (enqueue or run immediately)
router.post('/run', async (req, res) => {
  try {
    // run persistence helpers where available
    await Promise.allSettled([
      detectors.persistIpClashes?.(100),
      detectors.persistMacIpChurn?.(100),
      detectors.persistPortScans?.(50),
      detectors.persistBeacons?.(100),
    ])
    res.json({ status: 'scheduled' })
  } catch (err) {
    console.error('incidents run error', err)
    res.status(500).json({ error: 'internal' })
  }
})

export default router
