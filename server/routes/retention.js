import express from 'express'
import { getDb } from '../db.js'
import { loadConfig } from '../config.js'

const router = express.Router()

// Tables considered for retention/purge
const RETENTION_TABLES = [
  { name: 'device_events', tsColumn: 'ts' },
  { name: 'audit_log', tsColumn: 'ts' },
  { name: 'internet_summary', tsColumn: 'ts' },
  { name: 'daily_event_summary', tsColumn: 'ts' },
  { name: 'alerts', tsColumn: 'ts' }
]

router.get('/info', (req, res) => {
  const cfg = loadConfig()?.retention || { days: 365 }
  // read persisted setting if present
  const db = getDb()
  db.run(`CREATE TABLE IF NOT EXISTS retention_settings (k TEXT PRIMARY KEY, v TEXT)`)
  const row = db.prepare(`SELECT v FROM retention_settings WHERE k = 'retention_until'`).get()
  const retentionUntil = row ? row.v : null
  const backupRow = db.prepare(`SELECT v FROM retention_settings WHERE k = 'backup_done_for_until'`).get()
  const backupDoneFor = backupRow ? backupRow.v : null
  res.json({ retentionDays: cfg.days, retentionUntil, backupDoneFor, tables: RETENTION_TABLES.map(t => t.name) })
})

// Prevent showing the dialog (persisted server-side by flag)
router.post('/prevent', (req, res) => {
  // In-memory toggle — for now store in config runtime (non-persistent)
  const db = getDb()
  db.run(`CREATE TABLE IF NOT EXISTS retention_settings (k TEXT PRIMARY KEY, v TEXT)`)
  db.run(`INSERT OR REPLACE INTO retention_settings (k,v) VALUES ('prevent_dialog','true')`)
  res.json({ ok: true })
})

router.post('/update', (req, res) => {
  const { days, until } = req.body || {}
  const db = getDb()
  db.run(`CREATE TABLE IF NOT EXISTS retention_settings (k TEXT PRIMARY KEY, v TEXT)`)
  if (until) {
    // expect ISO date or timestamp
    const d = new Date(until)
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'invalid until' })
    db.run(`INSERT OR REPLACE INTO retention_settings (k,v) VALUES ('retention_until',?)`, [d.toISOString()])
    return res.json({ ok: true, retentionUntil: d.toISOString() })
  }
  if (Number.isInteger(days) && days >= 0) {
    // compute until as today + days
    const d = new Date()
    d.setDate(d.getDate() + days)
    db.run(`INSERT OR REPLACE INTO retention_settings (k,v) VALUES ('retention_until',?)`, [d.toISOString()])
    return res.json({ ok: true, retentionUntil: d.toISOString() })
  }
  return res.status(400).json({ error: 'invalid payload' })
})

// Manual purge endpoint — run as admin to delete rows older than retention_until
router.post('/purge', (req, res) => {
  const db = getDb()
  const row = db.prepare(`SELECT v FROM retention_settings WHERE k = 'retention_until'`).get()
  if (!row || !row.v) return res.status(400).json({ error: 'no retention_until set' })
  const cutoff = new Date(row.v).getTime()
  const tables = RETENTION_TABLES.map(t => ({ name: t.name, col: t.tsColumn }))
  const results = []
  for (const t of tables) {
    try {
      const before = db.get(`SELECT COUNT(*) as c FROM ${t.name} WHERE ${t.col} < ?`, [cutoff])?.c ?? 0
      db.run(`DELETE FROM ${t.name} WHERE ${t.col} < ?`, [cutoff])
      results.push({ table: t.name, deleted: before })
    } catch (e) {
      results.push({ table: t.name, error: String(e.message) })
    }
  }
  res.json({ ok: true, results })
})

// Backfill ts columns from updated_at where missing
router.post('/backfill', (req, res) => {
  const db = getDb()
  const tables = RETENTION_TABLES.map(t => t.name)
  const updated = []
  for (const name of tables) {
    try {
      // If ts column exists and updated_at exists, set ts = updated_at where ts IS NULL
      db.run(`UPDATE ${name} SET ts = updated_at WHERE ts IS NULL AND typeof(updated_at) = 'integer'`)
      const c = db.get(`SELECT COUNT(*) as c FROM ${name} WHERE ts IS NULL`)?.c ?? 0
      updated.push({ table: name, remainingNullTs: c })
    } catch (e) {
      updated.push({ table: name, error: String(e.message) })
    }
  }
  res.json({ ok: true, updated })
})

export default router
