import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { userExists, createUser, findUserByUsername, audit } from '../db.js'
import { getJwtSecret } from '../config.js'

const router = Router()

export const COOKIE_NAME = 'claudette_session'
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
}

function issueToken(res, username, remember = false) {
  const expiresIn = remember ? '30d' : '7d'
  const maxAge   = remember ? 30 * 24 * 60 * 60 * 1000 : undefined // undefined = session cookie
  const token = jwt.sign({ username }, getJwtSecret(), { expiresIn })
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, ...(maxAge ? { maxAge } : {}) })
}

// GET /api/auth/status — public, used by frontend to decide what to show
router.get('/status', (req, res) => {
  const registered = userExists()
  let authenticated = false
  let username = null
  const token = req.cookies?.[COOKIE_NAME]
  if (token) {
    try {
      const payload = jwt.verify(token, getJwtSecret())
      authenticated = true
      username = payload.username
    } catch { /* expired or invalid — stay unauthenticated */ }
  }
  res.json({ registered, authenticated, username })
})

// POST /api/auth/register — public, but blocked after the first account is created
router.post('/register', async (req, res) => {
  if (userExists()) {
    return res.status(409).json({ error: 'An account already exists. Please log in.' })
  }
  const { username, password } = req.body ?? {}
  if (!username || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, _ -)' })
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }
  const hash = await bcrypt.hash(password, 12)
  createUser(username, hash)
  audit('auth.register', { username })
  issueToken(res, username)
  res.json({ ok: true, username })
})

// POST /api/auth/login — public
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' })
  }
  const user = findUserByUsername(username)
  // Always run bcrypt compare to prevent timing attacks (even on invalid username)
  const dummyHash = '$2a$12$invalidhashfortimingprotectiononly000000000000000000000'
  const match = user ? await bcrypt.compare(password, user.password_hash)
                     : await bcrypt.compare(password, dummyHash).then(() => false)
  if (!match) {
    audit('auth.login_failed', { username })
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  audit('auth.login', { username })
  issueToken(res, username, !!req.body?.remember)
  res.json({ ok: true, username })
})

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' }).json({ ok: true })
})

export default router
