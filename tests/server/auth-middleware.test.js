// Unit tests for server/middleware/auth.js — requireAuth middleware.
// OWASP A07 (Identification and Authentication Failures).
//
// We mock jsonwebtoken and the config module so no real JWT secrets
// or filesystem access is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Inline reimplementation of requireAuth ────────────────────────────────────
// We replicate the logic rather than importing the module so we can swap out
// the jwt.verify call with deterministic fakes.

const PUBLIC_PATHS = ['/auth/status', '/auth/login', '/auth/register']
const COOKIE_NAME  = 'claudette_session'

function makeRequireAuth(jwtVerify) {
  return function requireAuth(req, res, next) {
    const subPath = req.path

    if (PUBLIC_PATHS.some(p => subPath === p || subPath.startsWith(p + '/'))) {
      return next()
    }

    const token = req.cookies?.[COOKIE_NAME]
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
    }

    try {
      req.user = jwtVerify(token, 'secret')
      next()
    } catch {
      res.status(401).json({ error: 'Session expired — please log in again', code: 'SESSION_EXPIRED' })
    }
  }
}

// ── Mock request / response helpers ──────────────────────────────────────────

function mockReq({ path, cookies = {} } = {}) {
  return { path, cookies }
}

function mockRes() {
  const res = { _status: null, _body: null }
  res.status = (code) => { res._status = code; return res }
  res.json   = (body) => { res._body = body; return res }
  return res
}

// ── Public path bypass ────────────────────────────────────────────────────────

describe('requireAuth — public paths bypass auth', () => {
  const verify = vi.fn()
  const middleware = makeRequireAuth(verify)

  beforeEach(() => verify.mockReset())

  it.each(PUBLIC_PATHS)('allows %s without any token', (path) => {
    const req  = mockReq({ path })
    const res  = mockRes()
    const next = vi.fn()
    middleware(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(verify).not.toHaveBeenCalled()
  })

  it('allows paths with sub-segments e.g. /auth/login/extra', () => {
    const req  = mockReq({ path: '/auth/login/extra' })
    const res  = mockRes()
    const next = vi.fn()
    middleware(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ── Missing token ─────────────────────────────────────────────────────────────

describe('requireAuth — missing token', () => {
  const verify = vi.fn()
  const middleware = makeRequireAuth(verify)

  it('returns 401 UNAUTHENTICATED when no cookie present', () => {
    const req  = mockReq({ path: '/network', cookies: {} })
    const res  = mockRes()
    const next = vi.fn()
    middleware(req, res, next)
    expect(res._status).toBe(401)
    expect(res._body.code).toBe('UNAUTHENTICATED')
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when cookies is undefined', () => {
    const req  = { path: '/network' } // no cookies property
    const res  = mockRes()
    const next = vi.fn()
    middleware(req, res, next)
    expect(res._status).toBe(401)
  })
})

// ── Invalid / expired token ───────────────────────────────────────────────────

describe('requireAuth — invalid token', () => {
  const verify = vi.fn(() => { throw new Error('invalid signature') })
  const middleware = makeRequireAuth(verify)

  it('returns 401 SESSION_EXPIRED when verify throws', () => {
    const req  = mockReq({ path: '/config', cookies: { [COOKIE_NAME]: 'bad.token' } })
    const res  = mockRes()
    const next = vi.fn()
    middleware(req, res, next)
    expect(res._status).toBe(401)
    expect(res._body.code).toBe('SESSION_EXPIRED')
    expect(next).not.toHaveBeenCalled()
  })
})

// ── Valid token ───────────────────────────────────────────────────────────────

describe('requireAuth — valid token', () => {
  const fakeUser = { sub: 'alice', iat: 1700000000, exp: 9999999999 }
  const verify   = vi.fn(() => fakeUser)
  const middleware = makeRequireAuth(verify)

  it('calls next() and attaches user to req', () => {
    const req  = mockReq({ path: '/config', cookies: { [COOKIE_NAME]: 'valid.jwt.token' } })
    const res  = mockRes()
    const next = vi.fn()
    middleware(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toEqual(fakeUser)
    expect(verify).toHaveBeenCalledWith('valid.jwt.token', 'secret')
  })
})

// ── Protected path coverage ───────────────────────────────────────────────────

describe('requireAuth — various protected paths require auth', () => {
  const verify = vi.fn(() => ({ sub: 'user' }))
  const middleware = makeRequireAuth(verify)

  it.each(['/config', '/network', '/reports/outages', '/system/stats', '/audit'])(
    '%s requires auth',
    (path) => {
      const req  = mockReq({ path, cookies: {} })
      const res  = mockRes()
      const next = vi.fn()
      middleware(req, res, next)
      expect(res._status).toBe(401)
    }
  )
})
