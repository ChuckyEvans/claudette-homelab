/**
 * Per-user UI cosmetic preferences stored as cookies.
 * Cookies are scoped to the current browser/user and survive page refresh
 * without being stored in the shared database.
 */
import { useState, useEffect } from 'react'

const PREFIX = 'claudette_ui_'

export function getUIPref(name, fallback = null) {
  const m = document.cookie.match('(?:^|; )' + PREFIX + name + '=([^;]*)')
  if (!m) return fallback
  try { return decodeURIComponent(m[1]) } catch { return fallback }
}

export function setUIPref(name, value) {
  // Far-future expiry so prefs survive browser restarts
  const expires = new Date('2099-01-01').toUTCString()
  // Serialize objects/arrays/booleans/numbers to JSON so types survive
  const out = (typeof value === 'string') ? value : JSON.stringify(value)
  document.cookie = `${PREFIX}${name}=${encodeURIComponent(out)}; expires=${expires}; path=/; SameSite=Lax`
}

// React hook for components to read & write a pref and re-render on change
export function useUIPref(name, fallback) {
  const raw = getUIPref(name, typeof fallback === 'function' ? fallback() : fallback)
  let initial = raw
  // Try to deserialize JSON values back to native types
  if (typeof raw === 'string') {
    try {
      if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']')) || raw === 'true' || raw === 'false' || /^-?\d+(\.\d+)?$/.test(raw)) {
        initial = JSON.parse(raw)
      }
    } catch {
      // keep as string
    }
  }
  const [val, setVal] = useState(initial)

  useEffect(() => {
    setUIPref(name, val)
  }, [name, val])

  return [val, setVal]
}

// Apply a set of defaults: returns an object with values taken from cookie if present
export function applyDefaults(defaults = {}) {
  const result = {}
  for (const k of Object.keys(defaults)) {
    const v = getUIPref(k, defaults[k])
    result[k] = v
  }
  return result
}
