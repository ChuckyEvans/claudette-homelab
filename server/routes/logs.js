import { Router } from 'express'
import { getLogs, getLogCounts } from '../utils/logBuffer.js'

const router = Router()

// GET /api/logs/counts?since=<ms>  — count new entries per level since a timestamp
router.get('/counts', (req, res) => {
  const since = parseInt(req.query.since) || 0
  res.json(getLogCounts(since))
})

// GET /api/logs?levels=info,warn,error&search=text&page=1&pageSize=100&order=asc
router.get('/', (req, res) => {
  try {
    const levels   = req.query.levels ? req.query.levels.split(',').map(l => l.trim()).filter(Boolean) : []
    const search   = req.query.search?.trim() ?? ''
    const page     = Math.max(1, parseInt(req.query.page)     || 1)
    const pageSize = Math.min(500, Math.max(10, parseInt(req.query.pageSize) || 100))
    const order    = req.query.order === 'desc' ? 'desc' : 'asc'

    res.json(getLogs({ levels, search, page, pageSize, order }))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
