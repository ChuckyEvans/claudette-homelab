import { Router } from 'express'
import { getDb } from '../db.js'

const router = Router()

// GET /api/audit?event=scan&q=192.168.68&limit=100&offset=0
router.get('/', (req, res) => {
  try {
    const db = getDb()
    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500)
    const offset = Math.max(parseInt(req.query.offset) || 0,   0)
    const event  = req.query.event?.trim() || null
    const q      = req.query.q?.trim()     || null

    const conditions = []
    const params     = []
    if (event) { conditions.push('event LIKE ?'); params.push(`${event}%`) }
    if (q)     { conditions.push('(event LIKE ? OR actor LIKE ? OR payload LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows  = db.all(`SELECT * FROM audit_log ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
    const total = db.get(`SELECT COUNT(*) AS n FROM audit_log ${where}`, params).n

    const newest = db.get('SELECT MAX(ts) AS ts FROM audit_log')
    const oldest = db.get('SELECT MIN(ts) AS ts FROM audit_log')

    res.json({
      entries: rows.map(r => ({ ...r, payload: JSON.parse(r.payload) })),
      total,
      limit,
      offset,
      newestTs: newest?.ts ?? null,
      oldestTs: oldest?.ts ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/audit  — clear all audit entries
router.delete('/', (req, res) => {
  try {
    getDb().run('DELETE FROM audit_log')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
