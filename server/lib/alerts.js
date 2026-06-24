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

export function listAlerts(limit = 100, offset = 0) {
  try {
    const db = getDb()
    return db.all('SELECT * FROM alerts ORDER BY last_seen DESC LIMIT ? OFFSET ?', [limit, offset])
  } catch {
    return []
  }
}

export default { upsertAlert, listAlerts }
