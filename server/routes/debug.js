import { Router } from 'express'
import { getDb, backfillInternetSummary, ensureInternetSummary } from '../db.js'
const router = Router()

// Run EXPLAIN QUERY PLAN for a provided SQL (POST body: { sql: 'SELECT ...' })
router.post('/explain', (req, res) => {
  try {
    const sql = req.body?.sql
    if (!sql) return res.status(400).json({ error: 'Missing sql in body' })
    const plan = getDb().all(`EXPLAIN QUERY PLAN ${sql}`)
    res.json({ plan })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Trigger backfill of internet summary (optionally provide fromTs/toTs in body)
router.post('/backfill/internet-summary', (req, res) => {
  try {
    ensureInternetSummary()
    const fromTs = Number(req.body?.fromTs ?? 0)
    const toTs = Number(req.body?.toTs ?? Date.now())
    const rows = backfillInternetSummary(fromTs, toTs)
    res.json({ backfilledDays: rows })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
