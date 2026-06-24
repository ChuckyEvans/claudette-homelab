// Unit tests for src/lib/themes.js
// Tests data shapes, constants, DOM-manipulating helpers, cookie/localStorage
// persistence helpers, bg-dim helpers, and accent preset helpers.
// All browser globals (document, localStorage) are stubbed — no jsdom needed.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import {
  THEMES, DEFAULT_THEME, VALID_THEME_IDS,
  applyTheme,
  loadTheme, saveTheme,
  readBgDim, saveBgDim, applyBgDim, loadBgDim,
  ACCENT_PRESETS, applyAccent, loadAccent, saveAccent, loadApplyAccent,
} from '../../src/lib/themes.js'

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

  it('contains "typhoon" (formerly "storm" before theme library refresh)', () => {
    expect(VALID_THEME_IDS).toContain('typhoon')
  })

  it('contains "milkyway" (formerly "starfield" before theme library refresh)', () => {
    expect(VALID_THEME_IDS).toContain('milkyway')
  })

  it('all entries are non-empty strings', () => {
    for (const id of VALID_THEME_IDS) {
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    }
  })

  it('contains all expected base themes', () => {
    const expected = ['dark', 'nebula', 'aurora', 'volcanic', 'matrix', 'cobalt', 'abyss', 'milkyway', 'neon', 'typhoon']
    for (const id of expected) {
      expect(VALID_THEME_IDS).toContain(id)
    }
  })
})

// ── applyTheme() ──────────────────────────────────────────────────────────────

describe('applyTheme()', () => {
  // Stub document.documentElement so applyTheme() can run in a Node environment
  const attrs = new Map()
  const styles = new Map()
  const mockEl = {
    setAttribute:    (k, v) => attrs.set(k, v),
    getAttribute:    (k)    => attrs.get(k) ?? null,
    removeAttribute: (k)    => attrs.delete(k),
    style: {
      setProperty:    (k, v) => styles.set(k, v),
      removeProperty: (k)    => styles.delete(k),
    },
  }
  beforeAll(() => { vi.stubGlobal('document', { documentElement: mockEl }) })
  afterEach(() => { mockEl.removeAttribute('data-theme') })

  it('sets data-theme attribute on <html> for a valid theme', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
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

// ── Cookie + localStorage helpers ─────────────────────────────────────────────
// We stub document.cookie and localStorage so tests run in Node without jsdom.

describe('loadTheme() / saveTheme()', () => {
  let cookieJar = ''
  const lsStore = {}

  beforeAll(() => {
    // Stub document with a real cookie-string getter/setter
    vi.stubGlobal('document', {
      ...globalThis.document,
      get cookie() { return cookieJar },
      set cookie(v) {
        // Real browsers accumulate name=value pairs; simulate that
        const [pair] = v.split(';')
        const [name, _val] = pair.split('=')
        const existing = cookieJar
          .split(';')
          .filter(c => !c.trim().startsWith(name.trim() + '='))
          .join(';')
        cookieJar = [existing, pair].filter(Boolean).join('; ')
      },
      documentElement: (() => {
        const attrs = new Map()
        const styles = new Map()
        return {
          setAttribute: (k, v) => attrs.set(k, v),
          getAttribute: (k) => attrs.get(k) ?? null,
          removeAttribute: (k) => attrs.delete(k),
          style: { setProperty: (k, v) => styles.set(k, v), removeProperty: (k) => styles.delete(k) },
        }
      })(),
    })
    vi.stubGlobal('localStorage', {
      getItem: (k) => lsStore[k] ?? null,
      setItem: (k, v) => { lsStore[k] = v },
      removeItem: (k) => { delete lsStore[k] },
    })
  })

  beforeEach(() => {
    cookieJar = ''
    for (const k of Object.keys(lsStore)) delete lsStore[k]
  })

  it('returns DEFAULT_THEME when no cookie or localStorage entry exists', () => {
    expect(loadTheme()).toBe(DEFAULT_THEME)
  })

  it('returns value saved via saveTheme()', () => {
    saveTheme('nebula')
    expect(loadTheme()).toBe('nebula')
  })

  it('falls back to localStorage when no cookie is set', () => {
    lsStore['claudette:theme'] = 'aurora'
    expect(loadTheme()).toBe('aurora')
  })

  it('prefers cookie over localStorage when both are set', () => {
    lsStore['claudette:theme'] = 'aurora'
    saveTheme('matrix')
    expect(loadTheme()).toBe('matrix')
  })

  it('saveTheme() does not throw for any valid theme id', () => {
    for (const id of VALID_THEME_IDS) {
      expect(() => saveTheme(id)).not.toThrow()
    }
  })
})

// ── readBgDim / saveBgDim / applyBgDim / loadBgDim ───────────────────────────

describe('BgDim helpers', () => {
  let cookieJar = ''
  const lsStore = {}
  const cssVars = {}

  beforeAll(() => {
    vi.stubGlobal('document', {
      ...globalThis.document,
      get cookie() { return cookieJar },
      set cookie(v) {
        const [pair] = v.split(';')
        const [name] = pair.split('=')
        const existing = cookieJar
          .split(';')
          .filter(c => !c.trim().startsWith(name.trim() + '='))
          .join(';')
        cookieJar = [existing, pair].filter(Boolean).join('; ')
      },
      documentElement: {
        style: {
          setProperty: (k, v) => { cssVars[k] = v },
          removeProperty: (k) => { delete cssVars[k] },
        },
        setAttribute: () => {},
        getAttribute: () => null,
        removeAttribute: () => {},
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: (k) => lsStore[k] ?? null,
      setItem: (k, v) => { lsStore[k] = v },
      removeItem: (k) => { delete lsStore[k] },
    })
  })

  beforeEach(() => {
    cookieJar = ''
    for (const k of Object.keys(lsStore)) delete lsStore[k]
    for (const k of Object.keys(cssVars)) delete cssVars[k]
  })

  it('readBgDim() returns 0.45 when no value is stored', () => {
    expect(readBgDim()).toBe(0.45)
  })

  it('readBgDim() returns value saved by saveBgDim()', () => {
    saveBgDim(0.6)
    expect(readBgDim()).toBeCloseTo(0.6, 5)
  })

  it('saveBgDim() clamps values above 0.95', () => {
    saveBgDim(1.5)
    expect(readBgDim()).toBeCloseTo(0.95, 5)
  })

  it('saveBgDim() clamps negative values to 0', () => {
    saveBgDim(-0.2)
    expect(readBgDim()).toBeCloseTo(0, 5)
  })

  it('readBgDim() falls back to localStorage when no cookie', () => {
    lsStore['claudette:bg-dim'] = '0.7'
    expect(readBgDim()).toBeCloseTo(0.7, 5)
  })

  it('applyBgDim() sets --bg-dim CSS var', () => {
    applyBgDim(0.5)
    expect(cssVars['--bg-dim']).toBe('0.5')
  })

  it('applyBgDim() clamps values above 0.95', () => {
    applyBgDim(2)
    expect(cssVars['--bg-dim']).toBe('0.95')
  })

  it('applyBgDim() clamps negative values to 0', () => {
    applyBgDim(-1)
    expect(cssVars['--bg-dim']).toBe('0')
  })

  it('loadBgDim() reads cookie and applies CSS var', () => {
    saveBgDim(0.3)
    loadBgDim()
    expect(cssVars['--bg-dim']).toBe('0.3')
  })
})

// ── ACCENT_PRESETS ────────────────────────────────────────────────────────────

describe('ACCENT_PRESETS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(ACCENT_PRESETS)).toBe(true)
    expect(ACCENT_PRESETS.length).toBeGreaterThan(0)
  })

  it('every preset has a non-empty string id', () => {
    for (const p of ACCENT_PRESETS) {
      expect(typeof p.id).toBe('string')
      expect(p.id.length).toBeGreaterThan(0)
    }
  })

  it('every preset has a non-empty label', () => {
    for (const p of ACCENT_PRESETS) {
      expect(typeof p.label).toBe('string')
      expect(p.label.length).toBeGreaterThan(0)
    }
  })

  it('no duplicate ids', () => {
    const ids = ACCENT_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes "theme" as the first entry (default/no-override)', () => {
    expect(ACCENT_PRESETS[0].id).toBe('theme')
  })

  it('non-default presets have exactly 5 vars (--ac-300 through --ac-700)', () => {
    for (const p of ACCENT_PRESETS.filter(p => p.id !== 'theme')) {
      expect(Array.isArray(p.vars)).toBe(true)
      expect(p.vars.length).toBe(5)
    }
  })

  it('non-default presets have a swatchHex matching hex colour format', () => {
    for (const p of ACCENT_PRESETS.filter(p => p.id !== 'theme')) {
      expect(p.swatchHex).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

// ── applyAccent / loadAccent / saveAccent / loadApplyAccent ───────────────────

describe('accent persistence and apply helpers', () => {
  let cookieJar = ''
  const cssVars = {}

  const mockEl = {
    style: {
      setProperty: (k, v) => { cssVars[k] = v },
      removeProperty: (k) => { delete cssVars[k] },
    },
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
  }

  beforeAll(() => {
    vi.stubGlobal('document', {
      ...globalThis.document,
      get cookie() { return cookieJar },
      set cookie(v) {
        const [pair] = v.split(';')
        const [name] = pair.split('=')
        const existing = cookieJar
          .split(';')
          .filter(c => !c.trim().startsWith(name.trim() + '='))
          .join(';')
        cookieJar = [existing, pair].filter(Boolean).join('; ')
      },
      documentElement: mockEl,
    })
  })

  beforeEach(() => {
    cookieJar = ''
    for (const k of Object.keys(cssVars)) delete cssVars[k]
  })

  it('loadAccent() returns "theme" when no cookie is set', () => {
    expect(loadAccent()).toBe('theme')
  })

  it('loadAccent() returns value saved by saveAccent()', () => {
    saveAccent('indigo')
    expect(loadAccent()).toBe('indigo')
  })

  it('applyAccent("theme") removes all accent CSS vars', () => {
    // First set them
    cssVars['--ac-300'] = '1 2 3'
    applyAccent('theme')
    expect(cssVars['--ac-300']).toBeUndefined()
  })

  it('applyAccent(null) removes all accent CSS vars', () => {
    cssVars['--ac-300'] = '1 2 3'
    applyAccent(null)
    expect(cssVars['--ac-300']).toBeUndefined()
  })

  it('applyAccent() sets all 5 CSS vars for a known accent', () => {
    applyAccent('indigo')
    expect(cssVars['--ac-300']).toBeDefined()
    expect(cssVars['--ac-400']).toBeDefined()
    expect(cssVars['--ac-500']).toBeDefined()
    expect(cssVars['--ac-600']).toBeDefined()
    expect(cssVars['--ac-700']).toBeDefined()
  })

  it('applyAccent() does nothing for an unknown accent id', () => {
    applyAccent('not-a-real-accent')
    expect(Object.keys(cssVars).filter(k => k.startsWith('--ac-'))).toHaveLength(0)
  })

  it('applyAccent() does not throw for any ACCENT_PRESETS id', () => {
    for (const p of ACCENT_PRESETS) {
      expect(() => applyAccent(p.id)).not.toThrow()
    }
  })

  it('loadApplyAccent() applies the stored accent', () => {
    saveAccent('sky')
    loadApplyAccent()
    expect(cssVars['--ac-300']).toBeDefined()
  })

  it('loadApplyAccent() when no accent stored applies "theme" (clears vars)', () => {
    cssVars['--ac-300'] = '1 2 3'
    loadApplyAccent()
    expect(cssVars['--ac-300']).toBeUndefined()
  })
})
