import express from 'express'
const router = express.Router()
import { getDb } from '../db.js'

router.get('/latest', (_req, res) => {
  try {
    const db = getDb()
    let row = null
    try {
      row = db.get('SELECT * FROM outage_diagnostics ORDER BY captured_at DESC LIMIT 1')
    } catch {
      try { row = db.get('SELECT * FROM outage_diagnostics_archived ORDER BY captured_at DESC LIMIT 1') } catch { row = null }
    }
    res.json({ ok: true, row })
  } catch (err) {
    console.error('[routes/diagnostics] error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
