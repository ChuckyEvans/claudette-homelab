import express from 'express'
import detectors from '../lib/detectors.js'
import alerts from '../lib/alerts.js'

const router = express.Router()

// Incidents endpoint: aggregate a few cheap detectors
router.get('/', async (req, res) => {
  try {
    // Run detectors and also return latest persisted alerts
    const [clashes, churn, portScans, beacons] = await Promise.all([
      detectors.detectIpClashes(100),
      detectors.detectMacIpChurn(100),
      detectors.detectPortScans(50),
      detectors.detectBeacons(100),
    ])
    const persisted = await alerts.listAlerts(200, 0)
    res.json({ clashes, churn, portScans, beacons, persisted })
  } catch (err) {
    console.error('incidents error', err)
    res.status(500).json({ error: 'internal' })
  }
})

export default router
