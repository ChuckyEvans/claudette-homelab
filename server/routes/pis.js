import express from 'express'
import { getDb } from '../db.js'

const router = express.Router()

function ensurePisTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      host TEXT,
      ssh_user TEXT,
      retention_days INTEGER DEFAULT 7,
      external_paths TEXT DEFAULT '[]'
    );
  `)
}

router.get('/:id', (req, res) => {
  const db = getDb()
  ensurePisTable(db)
  const id = parseInt(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const row = db.get('SELECT id,label,host,ssh_user,retention_days,external_paths FROM pis WHERE id = ?', [id])
  if (!row) return res.status(404).json({ error: 'not found' })
  try { row.external_paths = JSON.parse(row.external_paths) } catch { row.external_paths = [] }
  res.json(row)
})

router.put('/:id', (req, res) => {
  const db = getDb()
  ensurePisTable(db)
  const id = parseInt(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const retentionRaw = req.body.retention_days ?? req.body.retentionDays
  const retention = retentionRaw == null ? null : Number(retentionRaw)
  if (retention != null && (!Number.isFinite(retention) || retention < 0)) return res.status(400).json({ error: 'retention_days must be >= 0' })

  const external = req.body.external_paths ?? req.body.externalPaths ?? req.body.external
  let externalArr = []
  if (external == null) externalArr = null
  else if (typeof external === 'string') {
    try { externalArr = JSON.parse(external) } catch { externalArr = external.split(/[,\n]/).map(s => s.trim()).filter(Boolean) }
  } else if (Array.isArray(external)) externalArr = external
  else return res.status(400).json({ error: 'external_paths must be an array or string' })

  // Validate externalArr entries
  if (externalArr !== null && !externalArr.every(p => typeof p === 'string' && p.length > 0)) return res.status(400).json({ error: 'external_paths must be array of non-empty strings' })

  const cur = db.get('SELECT id FROM pis WHERE id = ?', [id])
  if (!cur) return res.status(404).json({ error: 'not found' })

  db.run('UPDATE pis SET retention_days = COALESCE(?, retention_days), external_paths = COALESCE(?, external_paths) WHERE id = ?', [retention === null ? null : parseInt(retention), externalArr === null ? null : JSON.stringify(externalArr), id])
  const updated = db.get('SELECT id,label,host,ssh_user,retention_days,external_paths FROM pis WHERE id = ?', [id])
  try { updated.external_paths = JSON.parse(updated.external_paths) } catch { updated.external_paths = [] }
  res.json(updated)
})

export default router
