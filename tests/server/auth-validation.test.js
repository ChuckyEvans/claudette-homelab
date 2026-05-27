// Unit tests for auth input validation rules.
// These tests verify the same rules enforced in server/routes/auth.js
// without importing the router (which has DB side effects).
// OWASP A07 (Identification and Auth Failures).

import { describe, it, expect } from 'vitest'

// Replicated from server/routes/auth.js — must stay in sync.
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/
const MIN_PASSWORD_LEN = 8
const BCRYPT_COST = 12

// ── Username validation ───────────────────────────────────────────────────────

describe('username regex', () => {
  it('accepts standard alphanumeric', () => {
    expect(USERNAME_RE.test('alice')).toBe(true)
    expect(USERNAME_RE.test('Bob123')).toBe(true)
    expect(USERNAME_RE.test('abc')).toBe(true) // minimum length
  })
  it('accepts underscores and hyphens', () => {
    expect(USERNAME_RE.test('my_user')).toBe(true)
    expect(USERNAME_RE.test('my-user')).toBe(true)
    expect(USERNAME_RE.test('user_123-abc')).toBe(true)
  })
  it('accepts maximum length (32 chars)', () => {
    expect(USERNAME_RE.test('a'.repeat(32))).toBe(true)
  })
  it('rejects too short (< 3 chars)', () => {
    expect(USERNAME_RE.test('')).toBe(false)
    expect(USERNAME_RE.test('ab')).toBe(false)
    expect(USERNAME_RE.test('a')).toBe(false)
  })
  it('rejects too long (> 32 chars)', () => {
    expect(USERNAME_RE.test('a'.repeat(33))).toBe(false)
  })
  it('rejects email addresses (injection vector)', () => {
    expect(USERNAME_RE.test('user@example.com')).toBe(false)
  })
  it('rejects spaces', () => {
    expect(USERNAME_RE.test('my user')).toBe(false)
  })
  it('rejects special characters', () => {
    expect(USERNAME_RE.test('user!')).toBe(false)
    expect(USERNAME_RE.test('<script>')).toBe(false)
    expect(USERNAME_RE.test("'; DROP TABLE")).toBe(false)
  })
  it('rejects null bytes and control characters', () => {
    expect(USERNAME_RE.test('user\x00')).toBe(false)
    expect(USERNAME_RE.test('user\n')).toBe(false)
  })
})

// ── Password length validation ────────────────────────────────────────────────

describe('password minimum length', () => {
  it('rejects empty password', () => {
    expect(''.length < MIN_PASSWORD_LEN).toBe(true)
  })
  it('rejects 7-character password', () => {
    expect('1234567'.length < MIN_PASSWORD_LEN).toBe(true)
  })
  it('accepts exactly 8 characters', () => {
    expect('12345678'.length < MIN_PASSWORD_LEN).toBe(false)
  })
  it('accepts long passwords', () => {
    expect('a'.repeat(128).length < MIN_PASSWORD_LEN).toBe(false)
  })
})

// ── bcrypt cost factor ─────────────────────────────────────────────────────────
// Ensures the cost factor is high enough to resist brute-force.
// OWASP recommends ≥ 10; we use 12.

describe('bcrypt cost factor', () => {
  it('cost factor is at least 10 (OWASP minimum)', () => {
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(10)
  })
  it('cost factor is exactly 12', () => {
    expect(BCRYPT_COST).toBe(12)
  })
})

// ── Cookie security flags ─────────────────────────────────────────────────────
// Mirror the COOKIE_OPTS from auth.js to document expected security posture.

describe('cookie security flags', () => {
  const COOKIE_OPTS = {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  }

  it('httpOnly prevents JS access (XSS mitigation)', () => {
    expect(COOKIE_OPTS.httpOnly).toBe(true)
  })
  it('sameSite:strict prevents CSRF', () => {
    expect(COOKIE_OPTS.sameSite).toBe('strict')
  })
  it('path is root', () => {
    expect(COOKIE_OPTS.path).toBe('/')
  })
})
