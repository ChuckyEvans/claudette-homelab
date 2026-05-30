/**
 * Per-user UI cosmetic preferences stored as cookies.
 * Cookies are scoped to the current browser/user and survive page refresh
 * without being stored in the shared database.
 */
const PREFIX = 'claudette_ui_'

export function getUIPref(name, fallback = null) {
  const m = document.cookie.match('(?:^|; )' + PREFIX + name + '=([^;]*)')
  if (!m) return fallback
  try { return decodeURIComponent(m[1]) } catch { return fallback }
}

export function setUIPref(name, value) {
  // Far-future expiry so prefs survive browser restarts
  const expires = new Date('2099-01-01').toUTCString()
  document.cookie = `${PREFIX}${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}
