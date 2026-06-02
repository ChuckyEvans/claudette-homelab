// Unit tests for src/lib/themes.js
// These test the data shape and constants — no DOM needed.
// applyTheme() uses a stubbed document (vi.stubGlobal) to avoid jsdom dependency.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { THEMES, DEFAULT_THEME, VALID_THEME_IDS, applyTheme } from '../../src/lib/themes.js'

// ── THEMES array shape ────────────────────────────────────────────────────────

describe('THEMES array', () => {
  it('has at least 16 entries', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(16)
  })

  it('every theme has a non-empty id string', () => {
    for (const t of THEMES) {
      expect(typeof t.id).toBe('string')
      expect(t.id.length).toBeGreaterThan(0)
    }
  })

  it('every theme has a non-empty label string', () => {
    for (const t of THEMES) {
      expect(typeof t.label).toBe('string')
      expect(t.label.length).toBeGreaterThan(0)
    }
  })

  it('every theme has a non-empty accent string (hex colour)', () => {
    for (const t of THEMES) {
      expect(typeof t.accent).toBe('string')
      expect(t.accent).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('every theme has a non-empty preview string', () => {
    for (const t of THEMES) {
      expect(typeof t.preview).toBe('string')
      expect(t.preview.length).toBeGreaterThan(0)
    }
  })

  it('no duplicate IDs', () => {
    const ids = THEMES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── DEFAULT_THEME ─────────────────────────────────────────────────────────────

describe('DEFAULT_THEME', () => {
  it('equals "dark"', () => {
    expect(DEFAULT_THEME).toBe('dark')
  })

  it('is present in THEMES', () => {
    expect(THEMES.some(t => t.id === DEFAULT_THEME)).toBe(true)
  })
})

// ── VALID_THEME_IDS ───────────────────────────────────────────────────────────

describe('VALID_THEME_IDS', () => {
  it('equals THEMES.map(t => t.id)', () => {
    expect(VALID_THEME_IDS).toEqual(THEMES.map(t => t.id))
  })

  it('contains "storm" (regression: was missing causing forest theme revert)', () => {
    expect(VALID_THEME_IDS).toContain('storm')
  })

  it('contains "starfield"', () => {
    expect(VALID_THEME_IDS).toContain('starfield')
  })

  it('all entries are non-empty strings', () => {
    for (const id of VALID_THEME_IDS) {
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    }
  })

  it('contains all expected base themes', () => {
    const expected = ['starfield', 'dark', 'nebula', 'aurora', 'synthwave', 'ocean', 'forest', 'volcanic', 'arctic', 'matrix', 'crimson', 'cobalt', 'amber', 'crystal', 'circuit', 'storm']
    for (const id of expected) {
      expect(VALID_THEME_IDS).toContain(id)
    }
  })
})

// ── applyTheme() ──────────────────────────────────────────────────────────────

describe('applyTheme()', () => {
  // Stub document.documentElement so applyTheme() can run in a Node environment
  const attrs = new Map()
  const mockEl = {
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute:  (k)    => attrs.get(k) ?? null,
    removeAttribute: (k)  => attrs.delete(k),
  }
  beforeAll(() => { vi.stubGlobal('document', { documentElement: mockEl }) })
  afterEach(() => { mockEl.removeAttribute('data-theme') })

  it('sets data-theme attribute on <html> for a valid theme', () => {
    applyTheme('storm')
    expect(document.documentElement.getAttribute('data-theme')).toBe('storm')
  })

  it('falls back to DEFAULT_THEME for an unknown theme id', () => {
    applyTheme('not-a-real-theme')
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME)
  })

  it('falls back to DEFAULT_THEME for null', () => {
    applyTheme(null)
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME)
  })

  it('falls back to DEFAULT_THEME for undefined', () => {
    applyTheme(undefined)
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME)
  })

  it('applies each valid theme without throwing', () => {
    for (const id of VALID_THEME_IDS) {
      expect(() => applyTheme(id)).not.toThrow()
      expect(document.documentElement.getAttribute('data-theme')).toBe(id)
    }
  })
})
