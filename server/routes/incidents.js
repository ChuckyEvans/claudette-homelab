import express from 'express'
import db from '../db.js'

const router = express.Router()

// Basic incidents endpoint: returns IP clashes aggregated by IP with seen MACs
router.get('/', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT ip, GROUP_CONCAT(DISTINCT mac) as macs, COUNT(DISTINCT mac) as mac_count
      FROM ip_history
      GROUP BY ip
      HAVING mac_count > 1
      ORDER BY mac_count DESC
      LIMIT 100
    `)
    const clashes = rows.map(r => ({ ip: r.ip, macs: r.macs ? r.macs.split(',') : [], mac_count: r.mac_count }))
    res.json({ clashes })
  } catch (err) {
    console.error('incidents error', err)
    res.status(500).json({ error: 'internal' })
  }
})

export default router
