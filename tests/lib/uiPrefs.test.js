// Unit tests for src/lib/uiPrefs.js
// getUIPref / setUIPref use document.cookie with a 'claudette_ui_' prefix.
// We provide a lightweight in-memory cookie jar instead of a full DOM environment
// to avoid ESM/CJS incompatibilities in jsdom's CSS dependencies.

import { describe, it, expect, beforeEach } from 'vitest'

// ── Minimal cookie jar ────────────────────────────────────────────────────────
// Replicates the browser cookie getter/setter contract:
//   GET  → "name1=val1; name2=val2"
//   SET  → adds/updates the named cookie; respects expired dates

let cookieJar = {}

Object.defineProperty(global, 'document', {
  configurable: true,
  value: {
    get cookie() {
      return Object.entries(cookieJar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    },
    set cookie(v) {
      const parts = v.split(';').map(s => s.trim())
      const nameVal = parts[0]
      const eqIdx = nameVal.indexOf('=')
      const name = nameVal.slice(0, eqIdx)
      const value = nameVal.slice(eqIdx + 1)

      // Honour expiry so clearing cookies works in beforeEach
      const expiresPart = parts.find(p => /^expires=/i.test(p))
      if (expiresPart) {
        const expDate = new Date(expiresPart.replace(/^expires=/i, ''))
        if (expDate <= new Date()) {
          delete cookieJar[name]
          return
        }
      }
      cookieJar[name] = value
    },
  },
})

import { getUIPref, setUIPref } from '../../src/lib/uiPrefs.js'

beforeEach(() => {
  cookieJar = {}
})

// ── getUIPref() ───────────────────────────────────────────────────────────────

describe('getUIPref()', () => {
  it('returns fallback when cookie is not set', () => {
    expect(getUIPref('sidebar_open', null)).toBeNull()
    expect(getUIPref('sidebar_open', 'default')).toBe('default')
  })

  it('returns the stored value after setUIPref', () => {
    setUIPref('theme_override', 'nebula')
    expect(getUIPref('theme_override')).toBe('nebula')
  })

  it('handles special characters via encode/decode round-trip', () => {
    const value = 'hello world & more'
    setUIPref('special', value)
    expect(getUIPref('special')).toBe(value)
  })

  it('returns null when name has no matching cookie', () => {
    setUIPref('other_key', 'value')
    expect(getUIPref('nonexistent', null)).toBeNull()
  })

  it('uses null as default fallback when none provided', () => {
    expect(getUIPref('missing')).toBeNull()
  })
  it('returns fallback when cookie value is malformed percent-encoding', () => {
    // Manually plant a cookie with an invalid percent sequence so decodeURIComponent throws
    cookieJar['claudette_ui_broken'] = '%ZZ'
    expect(getUIPref('broken', 'safe')).toBe('safe')
  })
})

// ── setUIPref() ───────────────────────────────────────────────────────────────

describe('setUIPref()', () => {
  it('sets a readable cookie with the claudette_ui_ prefix', () => {
    setUIPref('page_size', '25')
    expect(document.cookie).toContain('claudette_ui_page_size=25')
  })

  it('overwrites a previous value for the same preference', () => {
    setUIPref('layout', 'grid')
    setUIPref('layout', 'list')
    expect(getUIPref('layout')).toBe('list')
  })

  it('stores multiple distinct preferences independently', () => {
    setUIPref('a', '1')
    setUIPref('b', '2')
    expect(getUIPref('a')).toBe('1')
    expect(getUIPref('b')).toBe('2')
  })
})
