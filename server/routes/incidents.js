import express from 'express'
import detectors from '../lib/detectors.js'

const router = express.Router()

// Incidents endpoint: aggregate a few cheap detectors
router.get('/', async (req, res) => {
  try {
    const [clashes, churn, portScans, beacons] = await Promise.all([
      detectors.detectIpClashes(100),
      detectors.detectMacIpChurn(100),
      detectors.detectPortScans(50),
      detectors.detectBeacons(100),
    ])
    res.json({ clashes, churn, portScans, beacons })
  } catch (err) {
    console.error('incidents error', err)
    res.status(500).json({ error: 'internal' })
  }
})

export default router
