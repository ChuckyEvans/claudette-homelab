import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getDb, findUserByUsername, audit } from '../db.js'

const router = express.Router()

function requireAdmin(req, res, next) {
  const actor = req.user?.username
  if (!actor) return res.status(401).json({ error: 'Not authenticated' })
  const user = findUserByUsername(actor)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin required' })
  req.actor = actor
  next()
}

// GET /api/users - admin only: list users with basic pagination and filter
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const q = (req.query.q || '').replace(/[^a-z0-9]/gi, '')
  const page = Math.max(1, parseInt(req.query.page || '1', 10))
  const per = Math.min(100, Math.max(5, parseInt(req.query.per || '20', 10)))
  const offset = (page - 1) * per
  const db = getDb()
  let where = ''
  const params = []
  if (q) { where = 'WHERE username LIKE ?'; params.push(q + '%') }

  const total = db.get(`SELECT COUNT(*) as c FROM users ${where}`, params).c || 0
  const rows = db.all(`SELECT id, username, role, created_at FROM users ${where} ORDER BY username LIMIT ? OFFSET ?`, [...params, per, offset])
  const items = rows.map(r => ({ id: r.id, username: r.username, role: r.role, created_at: r.created_at }))
  res.json({ total: Number(total), page, per, items })
})

// POST /api/users/:username/promote - promote to admin
router.post('/:username/promote', requireAuth, requireAdmin, (req, res) => {
  const target = req.params.username
  const actor = req.actor
  if (actor === target) return res.status(400).json({ error: "Cannot change own role" })
  const db = getDb()
  const user = db.get('SELECT * FROM users WHERE username = ?', [target])
  if (!user) return res.status(404).json({ error: 'User not found' })
  db.run('UPDATE users SET role = ? WHERE username = ?', ['admin', target])
  audit('users.promote', { target, by: actor }, actor, req.ip)
  res.json({ ok: true })
})

// DELETE /api/users/:username - admin-only deletion with safeguards
router.delete('/:username', requireAuth, requireAdmin, (req, res) => {
  const target = req.params.username
  const actor = req.actor
  if (actor === target) return res.status(400).json({ error: "Cannot delete yourself" })
  const db = getDb()
  const user = db.get('SELECT * FROM users WHERE username = ?', [target])
  if (!user) return res.status(404).json({ error: 'User not found' })
  if (user.role === 'admin') {
    const adminCount = db.get("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").c || 0
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' })
  }
  db.run('DELETE FROM users WHERE username = ?', [target])
  audit('users.delete', { target, by: actor }, actor, req.ip)
  res.json({ ok: true })
})

// PUT /api/users/:username - update role or password
router.put('/:username', requireAuth, requireAdmin, async (req, res) => {
  const target = req.params.username
  const actor = req.actor
  if (actor === target) return res.status(400).json({ error: "Cannot change own role/password via this endpoint" })
  const { role, password } = req.body ?? {}
  const db = getDb()
  const user = db.get('SELECT * FROM users WHERE username = ?', [target])
  if (!user) return res.status(404).json({ error: 'User not found' })

  if (role) {
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' })
    db.run('UPDATE users SET role = ? WHERE username = ?', [role, target])
    audit('users.role_change', { target, role, by: actor }, actor, req.ip)
  }

  if (password) {
    // bcrypt is used elsewhere; import here lazily to avoid circulars
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.default.hash(password, 12)
    db.run('UPDATE users SET password_hash = ? WHERE username = ?', [hash, target])
    audit('users.password_change', { target, by: actor }, actor, req.ip)
  }

  res.json({ ok: true })
})

export default router
