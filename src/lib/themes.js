// Theme photos are served locally from /themes/{id}.jpg (bundled in dist, refreshable via Settings)
// Unsplash source URLs are kept server-side in server/routes/themes.js for refresh-on-demand.

export const THEMES = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Classic dark, clean & minimal',
    accent: '#6366f1',
    photo: null,
    preview: 'linear-gradient(160deg, #0f0f1a 0%, #0a0a12 100%)',
  },
  {
    id: 'milkyway',
    label: 'Milky Way',
    description: 'Galactic core, star-filled sky',
    accent: '#818cf8',
    photo: '/themes/milkyway.jpg',
    preview: 'url("/themes/milkyway-thumb.jpg")',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Northern lights over the Arctic',
    accent: '#34d399',
    photo: '/themes/aurora.jpg',
    preview: 'url("/themes/aurora-thumb.jpg")',
  },
  {
    id: 'sahara',
    label: 'Sahara',
    description: 'Sand dunes under a blazing sky',
    accent: '#fbbf24',
    photo: '/themes/sahara.jpg',
    preview: 'url("/themes/sahara-thumb.jpg")',
  },
  {
    id: 'coastal',
    label: 'Coastal',
    description: 'Ocean cliffs, crashing waves',
    accent: '#22d3ee',
    photo: '/themes/coastal.jpg',
    preview: 'url("/themes/coastal-thumb.jpg")',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    description: 'Rainforest canopy, emerald mist',
    accent: '#4ade80',
    photo: '/themes/amazon.jpg',
    preview: 'url("/themes/amazon-thumb.jpg")',
  },
  {
    id: 'alpine',
    label: 'Alpine',
    description: 'Snow-capped peaks at golden hour',
    accent: '#7dd3fc',
    photo: '/themes/alpine.jpg',
    preview: 'url("/themes/alpine-thumb.jpg")',
  },
  {
    id: 'volcanic',
    label: 'Volcanic',
    description: 'Lava flow into the ocean at night',
    accent: '#f97316',
    photo: '/themes/volcanic.jpg',
    preview: 'url("/themes/volcanic-thumb.jpg")',
  },
  {
    id: 'savanna',
    label: 'Savanna',
    description: 'African plains at sunset',
    accent: '#fb923c',
    photo: '/themes/savanna.jpg',
    preview: 'url("/themes/savanna-thumb.jpg")',
  },
  {
    id: 'outback',
    label: 'Outback',
    description: 'Australian red desert, star sky',
    accent: '#f87171',
    photo: '/themes/outback.jpg',
    preview: 'url("/themes/outback-thumb.jpg")',
  },
  {
    id: 'glacier',
    label: 'Glacier',
    description: 'Arctic ice shelf, turquoise water',
    accent: '#67e8f9',
    photo: '/themes/glacier.jpg',
    preview: 'url("/themes/glacier-thumb.jpg")',
  },
  {
    id: 'reef',
    label: 'Reef',
    description: 'Coral reef, underwater light shafts',
    accent: '#f472b6',
    photo: '/themes/reef.jpg',
    preview: 'url("/themes/reef-thumb.jpg")',
  },
  {
    id: 'redwood',
    label: 'Redwood',
    description: 'Ancient redwood forest, light shafts',
    accent: '#d97706',
    photo: '/themes/redwood.jpg',
    preview: 'url("/themes/redwood-thumb.jpg")',
  },
  {
    id: 'monsoon',
    label: 'Monsoon',
    description: 'Storm clouds over the ocean',
    accent: '#94a3b8',
    photo: '/themes/monsoon.jpg',
    preview: 'url("/themes/monsoon-thumb.jpg")',
  },
  {
    id: 'bioluminescent',
    label: 'Bioluminescent',
    description: 'Glowing ocean waves at night',
    accent: '#2dd4bf',
    photo: '/themes/bioluminescent.jpg',
    preview: 'url("/themes/bioluminescent-thumb.jpg")',
  },
  // ── Gradient-only themes (no photo, no upload) ───────────────────────────
  {
    id: 'neon',
    label: 'Neon',
    description: 'Cyberpunk violet and cyan dark',
    accent: '#22d3ee',
    photo: null,
    preview: 'linear-gradient(160deg, #050015 0%, #0a0025 50%, #001518 100%)',
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Smouldering deep red, near black',
    accent: '#fb923c',
    photo: null,
    preview: 'linear-gradient(160deg, #150200 0%, #1c0600 60%, #0a0000 100%)',
  },
  {
    id: 'twilight',
    label: 'Twilight',
    description: 'Dusk purple fading to deep indigo',
    accent: '#c084fc',
    photo: null,
    preview: 'linear-gradient(160deg, #0e0020 0%, #160032 50%, #060010 100%)',
  },
  {
    id: 'abyss',
    label: 'Abyss',
    description: 'Crushing deep ocean darkness',
    accent: '#38bdf8',
    photo: null,
    preview: 'linear-gradient(160deg, #00060e 0%, #000c1a 60%, #000508 100%)',
  },
  {
    id: 'matrix',
    label: 'Matrix',
    description: 'Terminal green on digital void',
    accent: '#4ade80',
    photo: null,
    preview: 'linear-gradient(160deg, #000e04 0%, #001508 60%, #000802 100%)',
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    description: 'Deep steel blue, industrial night',
    accent: '#60a5fa',
    photo: null,
    preview: 'linear-gradient(160deg, #010814 0%, #020d1e 60%, #01050e 100%)',
  },
]

export const DEFAULT_THEME = 'dark'

export const VALID_THEME_IDS = THEMES.map(t => t.id)

// ── Cookie helpers (JS-readable, 1-year expiry, per-browser/user) ───────────
function getCookie(name) {
  const m = document.cookie.match('(?:^|;)\\s*' + name + '=([^;]*)')
  return m ? decodeURIComponent(m[1]) : null
}

function setCookie(name, value) {
  const exp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Strict`
}

/** Read persisted theme from cookie (falls back to old localStorage key, then coastal for new users). */
export function loadTheme() {
  return getCookie('claudette_theme') ?? localStorage.getItem('claudette:theme') ?? 'coastal'
}

/** Persist theme choice to cookie. */
export function saveTheme(themeId) {
  setCookie('claudette_theme', themeId)
}

/** Read persisted bgDim from cookie (falls back to old localStorage key on first visit). */
export function readBgDim() {
  const v = getCookie('claudette_bgdim') ?? localStorage.getItem('claudette:bg-dim')
  return v !== null ? parseFloat(v) : 0.45
}

/** Persist bgDim choice to cookie. */
export function saveBgDim(val) {
  setCookie('claudette_bgdim', String(Math.min(0.95, Math.max(0, Number(val)))))
}

/** Set background overlay darkness via CSS var. 0 = vivid, 0.95 = very dark. */
export function applyBgDim(val) {
  const v = Math.min(0.95, Math.max(0, Number(val)))
  document.documentElement.style.setProperty('--bg-dim', String(v))
}

/** Read stored dim value from cookie and apply it. */
export function loadBgDim() {
  applyBgDim(readBgDim())
}

/** Apply a theme by setting data-theme on <html>. Falls back to default. */
export function applyTheme(themeId) {
  const id = VALID_THEME_IDS.includes(themeId) ? themeId : DEFAULT_THEME
  document.documentElement.setAttribute('data-theme', id)
  const theme = THEMES.find(t => t.id === id)
  if (theme?.photo) {
    document.documentElement.setAttribute('data-photo-theme', '')
    document.documentElement.style.setProperty('--theme-photo', `url("${theme.photo}")`)
  } else {
    document.documentElement.removeAttribute('data-photo-theme')
    document.documentElement.style.removeProperty('--theme-photo')
  }
}
