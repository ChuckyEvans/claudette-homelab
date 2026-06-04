// Theme photos are served locally from /themes/{id}.jpg (bundled in dist, refreshable via Settings)
// Unsplash source URLs are kept server-side in server/routes/themes.js for refresh-on-demand.

export const THEMES = [
  // ── Gradient/solid themes ────────────────────────────────────────────────
  {
    id: 'abyss',
    label: 'Abyss',
    description: 'Crushing deep ocean darkness',
    accent: '#38bdf8',
    photo: null,
    preview: 'linear-gradient(160deg, #00060e 0%, #000c1a 60%, #000508 100%)',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'alpine',
    label: 'Alpine',
    description: 'Snow-capped peaks at golden hour',
    accent: '#7dd3fc',
    photo: '/themes/alpine.jpg',
    preview: 'url("/themes/alpine-thumb.jpg")',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    description: 'Rainforest canopy, emerald mist',
    accent: '#4ade80',
    photo: '/themes/amazon.jpg',
    preview: 'url("/themes/amazon-thumb.jpg")',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'archipelago',
    label: 'Archipelago',
    description: 'Scattered islands, crystal waters',
    accent: '#38bdf8',
    photo: '/themes/archipelago.jpg',
    preview: 'url("/themes/archipelago-thumb.jpg")',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Northern lights over the Arctic',
    accent: '#34d399',
    photo: '/themes/aurora.jpg',
    preview: 'url("/themes/aurora-thumb.jpg")',
  },
  {
    id: 'bioluminescent',
    label: 'Bioluminescent',
    description: 'Glowing ocean waves at night',
    accent: '#2dd4bf',
    photo: '/themes/bioluminescent.jpg',
    preview: 'url("/themes/bioluminescent-thumb.jpg")',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'canyon',
    label: 'Canyon',
    description: 'Sculpted slot canyons, warm stone',
    accent: '#fb923c',
    photo: '/themes/canyon.jpg',
    preview: 'url("/themes/canyon-thumb.jpg")',
  },
  {
    id: 'cherry',
    label: 'Cherry',
    description: 'Cherry blossoms, spring pink',
    accent: '#f472b6',
    photo: '/themes/cherry.jpg',
    preview: 'url("/themes/cherry-thumb.jpg")',
  },
  {
    id: 'citynight',
    label: 'City Night',
    description: 'Urban skyline after dark',
    accent: '#c084fc',
    photo: '/themes/citynight.jpg',
    preview: 'url("/themes/citynight-thumb.jpg")',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'coastal',
    label: 'Coastal',
    description: 'Ocean cliffs, crashing waves',
    accent: '#22d3ee',
    photo: '/themes/coastal.jpg',
    preview: 'url("/themes/coastal-thumb.jpg")',
  },
  // ── Gradient/solid themes ────────────────────────────────────────────────
  {
    id: 'cobalt',
    label: 'Cobalt',
    description: 'Deep steel blue, industrial night',
    accent: '#60a5fa',
    photo: null,
    preview: 'linear-gradient(160deg, #010814 0%, #020d1e 60%, #01050e 100%)',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'crater',
    label: 'Crater',
    description: 'Vivid crater lake, volcanic basin',
    accent: '#22d3ee',
    photo: '/themes/crater.jpg',
    preview: 'url("/themes/crater-thumb.jpg")',
  },
  // ── Gradient/solid themes ────────────────────────────────────────────────
  {
    id: 'dark',
    label: 'Dark',
    description: 'Classic dark, clean & minimal',
    accent: '#6366f1',
    photo: null,
    preview: 'linear-gradient(160deg, #0f0f1a 0%, #0a0a12 100%)',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'dunes',
    label: 'Dunes',
    description: 'Rolling sand dunes, desert light',
    accent: '#fbbf24',
    photo: '/themes/dunes.jpg',
    preview: 'url("/themes/dunes-thumb.jpg")',
  },
  // ── Gradient/solid themes ────────────────────────────────────────────────
  {
    id: 'ember',
    label: 'Ember',
    description: 'Smouldering deep red, near black',
    accent: '#fb923c',
    photo: null,
    preview: 'linear-gradient(160deg, #150200 0%, #1c0600 60%, #0a0000 100%)',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'fjord',
    label: 'Fjord',
    description: 'Norwegian fjords, still water',
    accent: '#7dd3fc',
    photo: '/themes/fjord.jpg',
    preview: 'url("/themes/fjord-thumb.jpg")',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'glacier',
    label: 'Glacier',
    description: 'Arctic ice shelf, turquoise water',
    accent: '#67e8f9',
    photo: '/themes/glacier.jpg',
    preview: 'url("/themes/glacier-thumb.jpg")',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'iceberg',
    label: 'Iceberg',
    description: 'Polar icebergs, frozen ocean',
    accent: '#93c5fd',
    photo: '/themes/iceberg.jpg',
    preview: 'url("/themes/iceberg-thumb.jpg")',
  },
  {
    id: 'jungle',
    label: 'Jungle',
    description: 'Dense jungle, dappled canopy light',
    accent: '#a3e635',
    photo: '/themes/jungle.jpg',
    preview: 'url("/themes/jungle-thumb.jpg")',
  },
  {
    id: 'karst',
    label: 'Karst',
    description: 'Misty limestone peaks, morning fog',
    accent: '#2dd4bf',
    photo: '/themes/karst.jpg',
    preview: 'url("/themes/karst-thumb.jpg")',
  },
  {
    id: 'lagoon',
    label: 'Lagoon',
    description: 'Tropical lagoon, clear shallows',
    accent: '#34d399',
    photo: '/themes/lagoon.jpg',
    preview: 'url("/themes/lagoon-thumb.jpg")',
  },
  {
    id: 'lakeshore',
    label: 'Lakeshore',
    description: 'Mountain lake, mirror reflection',
    accent: '#38bdf8',
    photo: '/themes/lakeshore.jpg',
    preview: 'url("/themes/lakeshore-thumb.jpg")',
  },
  {
    id: 'lightning',
    label: 'Lightning',
    description: 'Thunderstorm, electric sky',
    accent: '#facc15',
    photo: '/themes/lightning.jpg',
    preview: 'url("/themes/lightning-thumb.jpg")',
  },
  {
    id: 'mangrove',
    label: 'Mangrove',
    description: 'Tangled mangrove coast at dusk',
    accent: '#4ade80',
    photo: '/themes/mangrove.jpg',
    preview: 'url("/themes/mangrove-thumb.jpg")',
  },
  // ── Gradient/solid themes ────────────────────────────────────────────────
  {
    id: 'matrix',
    label: 'Matrix',
    description: 'Terminal green on digital void',
    accent: '#4ade80',
    photo: null,
    preview: 'linear-gradient(160deg, #000e04 0%, #001508 60%, #000802 100%)',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'meadow',
    label: 'Meadow',
    description: 'Alpine meadow, wildflower bloom',
    accent: '#34d399',
    photo: '/themes/meadow.jpg',
    preview: 'url("/themes/meadow-thumb.jpg")',
  },
  {
    id: 'mesa',
    label: 'Mesa',
    description: 'Desert mesa, red rock at sunset',
    accent: '#f87171',
    photo: '/themes/mesa.jpg',
    preview: 'url("/themes/mesa-thumb.jpg")',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'milkyway',
    label: 'Milky Way',
    description: 'Galactic core, star-filled sky',
    accent: '#818cf8',
    photo: '/themes/milkyway.jpg',
    preview: 'url("/themes/milkyway-thumb.jpg")',
  },
  {
    id: 'monsoon',
    label: 'Monsoon',
    description: 'Storm clouds over the ocean',
    accent: '#94a3b8',
    photo: '/themes/monsoon.jpg',
    preview: 'url("/themes/monsoon-thumb.jpg")',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'nebula',
    label: 'Nebula',
    description: 'Deep space nebula, cosmic dust',
    accent: '#c084fc',
    photo: '/themes/nebula.jpg',
    preview: 'url("/themes/nebula-thumb.jpg")',
  },
  // ── Gradient/solid themes ────────────────────────────────────────────────
  {
    id: 'neon',
    label: 'Neon',
    description: 'Cyberpunk violet and cyan dark',
    accent: '#22d3ee',
    photo: null,
    preview: 'linear-gradient(160deg, #050015 0%, #0a0025 50%, #001518 100%)',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'outback',
    label: 'Outback',
    description: 'Australian red desert, star sky',
    accent: '#f87171',
    photo: '/themes/outback.jpg',
    preview: 'url("/themes/outback-thumb.jpg")',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'pampas',
    label: 'Pampas',
    description: 'South American grasslands at dusk',
    accent: '#fcd34d',
    photo: '/themes/pampas.jpg',
    preview: 'url("/themes/pampas-thumb.jpg")',
  },
  {
    id: 'peak',
    label: 'Peak',
    description: 'Snow-capped summit, crisp air',
    accent: '#7dd3fc',
    photo: '/themes/peak.jpg',
    preview: 'url("/themes/peak-thumb.jpg")',
  },
  {
    id: 'rainforest',
    label: 'Rainforest',
    description: 'Tropical canopy after the rain',
    accent: '#4ade80',
    photo: '/themes/rainforest.jpg',
    preview: 'url("/themes/rainforest-thumb.jpg")',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'redwood',
    label: 'Redwood',
    description: 'Ancient redwood forest, light shafts',
    accent: '#d97706',
    photo: '/themes/redwood.jpg',
    preview: 'url("/themes/redwood-thumb.jpg")',
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
    id: 'sahara',
    label: 'Sahara',
    description: 'Sand dunes under a blazing sky',
    accent: '#fbbf24',
    photo: '/themes/sahara.jpg',
    preview: 'url("/themes/sahara-thumb.jpg")',
  },
  {
    id: 'savanna',
    label: 'Savanna',
    description: 'African plains at sunset',
    accent: '#fb923c',
    photo: '/themes/savanna.jpg',
    preview: 'url("/themes/savanna-thumb.jpg")',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'temple',
    label: 'Temple',
    description: 'Ancient ruins, time-worn stone',
    accent: '#fbbf24',
    photo: '/themes/temple.jpg',
    preview: 'url("/themes/temple-thumb.jpg")',
  },
  {
    id: 'tidepool',
    label: 'Tidepool',
    description: 'Rocky coastal tidepool, low tide',
    accent: '#67e8f9',
    photo: '/themes/tidepool.jpg',
    preview: 'url("/themes/tidepool-thumb.jpg")',
  },
  {
    id: 'tundra',
    label: 'Tundra',
    description: 'Arctic tundra, permafrost plains',
    accent: '#93c5fd',
    photo: '/themes/tundra.jpg',
    preview: 'url("/themes/tundra-thumb.jpg")',
  },
  // ── Gradient/solid themes ────────────────────────────────────────────────
  {
    id: 'twilight',
    label: 'Twilight',
    description: 'Dusk purple fading to deep indigo',
    accent: '#c084fc',
    photo: null,
    preview: 'linear-gradient(160deg, #0e0020 0%, #160032 50%, #060010 100%)',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'typhoon',
    label: 'Typhoon',
    description: 'Open ocean, approaching storm',
    accent: '#94a3b8',
    photo: '/themes/typhoon.jpg',
    preview: 'url("/themes/typhoon-thumb.jpg")',
  },
  {
    id: 'valley',
    label: 'Valley',
    description: 'Lush highland valley, morning mist',
    accent: '#4ade80',
    photo: '/themes/valley.jpg',
    preview: 'url("/themes/valley-thumb.jpg")',
  },
  {
    id: 'vineyard',
    label: 'Vineyard',
    description: 'Wine country hills at golden hour',
    accent: '#fb7185',
    photo: '/themes/vineyard.jpg',
    preview: 'url("/themes/vineyard-thumb.jpg")',
  },
  // ── Photo themes (local) ─────────────────────────────────────────────────
  {
    id: 'volcanic',
    label: 'Volcanic',
    description: 'Lava flow into the ocean at night',
    accent: '#f97316',
    photo: '/themes/volcanic.jpg',
    preview: 'url("/themes/volcanic-thumb.jpg")',
  },
  // ── Photo themes (internet) ──────────────────────────────────────────────
  {
    id: 'waterfall',
    label: 'Waterfall',
    description: 'Jungle waterfall, tropical mist',
    accent: '#2dd4bf',
    photo: '/themes/waterfall.jpg',
    preview: 'url("/themes/waterfall-thumb.jpg")',
  },
  {
    id: 'wetlands',
    label: 'Wetlands',
    description: 'Coastal marsh, birds at dawn',
    accent: '#84cc16',
    photo: '/themes/wetlands.jpg',
    preview: 'url("/themes/wetlands-thumb.jpg")',
  },
  {
    id: 'wildfire',
    label: 'Wildfire',
    description: 'Forest fire, crimson dusk',
    accent: '#f97316',
    photo: '/themes/wildfire.jpg',
    preview: 'url("/themes/wildfire-thumb.jpg")',
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

// ── Accent colour customisation ───────────────────────────────────────────────
// Each preset lists the 5 RGB triplets for --ac-300 … --ac-700.

export const ACCENT_PRESETS = [
  { id: 'theme',   label: 'Theme default', description: 'Use the accent from the selected theme' },
  { id: 'indigo',  label: 'Indigo',        description: 'Classic deep indigo',  swatchHex: '#818cf8', vars: ['165 180 252', '129 140 248',  '99 102 241',  '79  70 229',  '67  56 202'] },
  { id: 'violet',  label: 'Violet',        description: 'Rich violet purple',   swatchHex: '#a78bfa', vars: ['196 181 253', '167 139 250', '139  92 246', '124  58 237', '109  40 217'] },
  { id: 'sky',     label: 'Sky Blue',      description: 'Clear sky blue',       swatchHex: '#38bdf8', vars: ['125 211 252',  '56 189 248',  '14 165 233',   '2 132 199',   '3 105 161'] },
  { id: 'cyan',    label: 'Cyan',          description: 'Electric cyan',        swatchHex: '#22d3ee', vars: ['103 232 249',  '34 211 238',   '6 182 212',   '8 145 178',  '14 116 144'] },
  { id: 'teal',    label: 'Teal',          description: 'Deep teal',            swatchHex: '#2dd4bf', vars: [ '94 234 212',  '45 212 191',  '20 184 166',  '13 148 136',  '15 118 110'] },
  { id: 'emerald', label: 'Emerald',       description: 'Vivid emerald green',  swatchHex: '#34d399', vars: ['110 231 183',  '52 211 153',  '16 185 129',   '5 150 105',   '4 120  87'] },
  { id: 'green',   label: 'Green',         description: 'Fresh leafy green',    swatchHex: '#4ade80', vars: [ '74 222 128',  '34 197  94',  '22 163  74',  '21 128  61',  '20 101  48'] },
  { id: 'lime',    label: 'Lime',          description: 'Sharp lime green',     swatchHex: '#a3e635', vars: ['190 242 100', '163 230  53', '132 204  22', '101 163  13',  '77 124   8'] },
  { id: 'amber',   label: 'Amber',         description: 'Warm golden amber',    swatchHex: '#fbbf24', vars: ['252 211  77', '251 191  36', '245 158  11', '217 119   6', '180  83   9'] },
  { id: 'orange',  label: 'Orange',        description: 'Bold orange',          swatchHex: '#fb923c', vars: ['253 186 116', '251 146  60', '249 115  22', '234  88  12', '194  65  12'] },
  { id: 'red',     label: 'Red',           description: 'Vivid red',            swatchHex: '#f87171', vars: ['252 165 165', '248 113 113', '239  68  68', '220  38  38', '185  28  28'] },
  { id: 'rose',    label: 'Rose',          description: 'Soft rose pink',       swatchHex: '#fb7185', vars: ['253 164 175', '251 113 133', '244  63  94', '225  29  72', '190  18  60'] },
  { id: 'pink',    label: 'Pink',          description: 'Bright hot pink',      swatchHex: '#f472b6', vars: ['249 168 212', '244 114 182', '236  72 153', '219  39 119', '190  24  93'] },
  { id: 'slate',   label: 'Slate',         description: 'Cool neutral slate',   swatchHex: '#94a3b8', vars: ['203 213 225', '148 163 184', '100 116 139',  '71  85 105',  '51  65  85'] },
]

const ACCENT_CSS_PROPS = ['--ac-300', '--ac-400', '--ac-500', '--ac-600', '--ac-700']

/** Apply a named accent override, or remove override if id is 'theme'. */
export function applyAccent(accentId) {
  const el = document.documentElement
  if (!accentId || accentId === 'theme') {
    ACCENT_CSS_PROPS.forEach(p => el.style.removeProperty(p))
    return
  }
  const preset = ACCENT_PRESETS.find(a => a.id === accentId)
  if (!preset?.vars) return
  ACCENT_CSS_PROPS.forEach((p, i) => el.style.setProperty(p, preset.vars[i]))
}

/** Read persisted accent from cookie. */
export function loadAccent() {
  return getCookie('claudette_accent') ?? 'theme'
}

/** Persist accent choice to cookie. */
export function saveAccent(accentId) {
  setCookie('claudette_accent', accentId)
}

/** Read stored accent and apply it. */
export function loadApplyAccent() {
  applyAccent(loadAccent())
}
