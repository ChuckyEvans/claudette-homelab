import express from 'express'
import { getDb } from '../db.js'

const router = express.Router()

// Server-side generic pagination for large tables.
// Query params:
// - table (required)
// - page (1-based, default 1)
// - limit (default 25, max 200)
// - q (search term, applies to text columns provided in `searchCols` param comma-separated)
// - searchCols (comma-separated list of columns to search with LIKE)
// - order (column name)
// - dir (asc|desc)
// - filters (JSON object string with equality filters)

router.get('/', (req, res) => {
  try {
    const db = getDb()
    const { table, page = '1', limit = '25', q, searchCols, order, dir = 'desc', filters } = req.query
    if (!table) return res.status(400).json({ error: 'table is required' })

    const pg = Math.max(1, Number(page) || 1)
    const lim = Math.min(200, Math.max(1, Number(limit) || 25))
    const offset = (pg - 1) * lim

    // Validate table exists
    const tbl = db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table])
    if (!tbl) return res.status(404).json({ error: 'table not found' })

    const where = []
    const params = []

    // filters: JSON string of { col: value }
    if (filters) {
      try {
        const f = typeof filters === 'string' ? JSON.parse(filters) : filters
        for (const [k, v] of Object.entries(f)) {
          where.push(`${k} = ?`)
          params.push(v)
        }
      } catch {
        return res.status(400).json({ error: 'invalid filters JSON' })
      }
    }

    // search
    if (q && searchCols) {
      const cols = String(searchCols).split(',').map(s => s.trim()).filter(Boolean)
      if (cols.length) {
        const likeClauses = cols.map(c => { params.push(`%${q}%`); return `${c} LIKE ?` })
        where.push(`(${likeClauses.join(' OR ')})`)
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const orderSql = order ? `ORDER BY ${order} ${dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}` : ''

    const totalRow = db.get(`SELECT COUNT(*) as c FROM ${table} ${whereSql}`, params)
    const rows = db.all(`SELECT * FROM ${table} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`, [...params, lim, offset])

    return res.json({ table, page: pg, limit: lim, total: totalRow?.c ?? 0, rows })
  } catch (err) {
    console.error('[paginate]', err.message)
    return res.status(500).json({ error: 'server error' })
  }
})

export default router
