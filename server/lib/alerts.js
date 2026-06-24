import { getDb } from '../db.js'

export function upsertAlert(type, key, payload = {}) {
  const db = getDb()
  const now = Date.now()
  // key is unique per alert type (e.g., ip or mac)
  db.run(`
    INSERT INTO alerts (type, key, payload, first_seen, last_seen, count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(type, key) DO UPDATE SET
      payload = excluded.payload,
      last_seen = ?,
      count = count + 1
  `, [type, key, JSON.stringify(payload), now, now, now])
}

export function listAlerts(limit = 100, offset = 0, opts = {}) {
  try {
    const db = getDb()
    const clauses = []
    const params = []

    if (opts.type) {
      clauses.push('type = ?')
      params.push(opts.type)
    }

    if (opts.age) {
      // age in days: only show alerts with last_seen within age days
      const cutoff = Date.now() - (Number(opts.age) || 30) * 24 * 60 * 60 * 1000
      clauses.push('last_seen >= ?')
      params.push(cutoff)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    let order = 'last_seen DESC'
    if (opts.sort === 'first_seen') order = 'first_seen DESC'
    if (opts.sort === 'count') order = 'count DESC'

    const l = Math.min(5000, Number(limit) || 100)
    const o = Math.max(0, Number(offset) || 0)

    const sql = `SELECT * FROM alerts ${where} ORDER BY ${order} LIMIT ? OFFSET ?`
    return db.all(sql, [...params, l, o])
  } catch {
    return []
  }
}

export default { upsertAlert, listAlerts }
