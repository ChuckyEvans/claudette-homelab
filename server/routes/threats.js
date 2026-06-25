import { Router } from 'express'
import Parser from 'rss-parser'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig } from '../config.js'
import { audit } from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = Router()
const parser = new Parser({ timeout: 15000 })

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'state.json')

const FEEDS = [
  {
    name: 'CVEfeed High/Critical',
    url: 'https://cvefeed.io/rssfeed/severity/high.xml',
    severity: 'high',
  },
  // CVEfeed Critical (/severity/critical.xml) returns 404 — removed
  // NIST NVD RSS feed retired by NIST in 2024 — removed
  {
    name: 'GitHub Security Advisories',
    url: 'https://github.com/security-advisories.atom',
    severity: 'medium',
  },
]

// cvefeed.io embeds "Severity: 9.8 | CRITICAL" in item descriptions
function parseSeverity(text, fallback) {
  const m = text.match(/severity[:\s]+[\d.]+\s*\|\s*(critical|high|medium|low)/i)
  if (m) return m[1].toLowerCase()
  return fallback
}

// Best-effort package/project extraction from CVE/advisory titles
function extractPackage(title) {
  // CVEfeed: "CVE-2024-1234 | Critical | Product Name Here"
  const pipeMatch = title.match(/CVE-\d{4}-\d+\s*\|\s*\w+\s*\|\s*(.+)/)
  if (pipeMatch) return pipeMatch[1].trim()

  // "vulnerability/issue in package-name" at end of title
  const inMatch = title.match(/\bin\s+([\w./@-]+(?:[\s/][\w./@-]+)?)\s*(?:v[\d.]+)?\s*$/i)
  if (inMatch) return inMatch[1].trim()

  // GitHub advisory colon prefix: "package-name: some vulnerability"
  const colonMatch = title.match(/^([\w./@-]+(?:\/[\w./@-]+)?):\s+/i)
  if (colonMatch && !colonMatch[1].match(/^(CVE|GHSA)-/i)) return colonMatch[1].trim()

  return null
}

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 }

let _cachedThreats = []
let _lastRefresh = null
// Track consecutive failures and cooldown per feed in-memory
const _feedState = new Map()

function ensureDataDir() {
  const dir = path.dirname(STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// Load persisted threats from disk on startup
try {
  if (fs.existsSync(STATE_FILE)) {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    _cachedThreats = data.cached_threats ?? []
    _lastRefresh   = data.last_refresh   ?? null
  }
} catch {}

function loadSeen() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      return new Set(data.seen_threats ?? [])
    }
  } catch {}
  return new Set()
}

function saveSeen(seen) {
  try {
    ensureDataDir()
    let data = {}
    if (fs.existsSync(STATE_FILE)) {
      try { data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch {}
    }
    data.seen_threats   = [...seen].slice(-500)
    data.cached_threats = _cachedThreats.slice(0, 200)
    data.last_refresh   = _lastRefresh
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
  } catch {}
}

function matchesKeywords(text, keywords) {
  if (!keywords?.length) return true // no filter = show all
  const lower = text.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

export async function refreshThreats(broadcast) {
  const cfg = loadConfig()
  const keywords = cfg?.threats?.keywords ?? []
  const threshold = cfg?.threats?.severity_threshold ?? 'medium'
  const thresholdLevel = SEVERITY_ORDER[threshold] ?? 2
  const seen = loadSeen()
  const newThreats = []

  for (const feed of FEEDS) {
    const state = _feedState.get(feed.url) || { failures: 0, disabledUntil: 0 }
    const now = Date.now()
    if (state.disabledUntil && state.disabledUntil > now) {
      console.error(`[threats] Skipping ${feed.name}: in cooldown until ${new Date(state.disabledUntil).toISOString()}`)
      continue
    }
    try {
      // Fetch with retries to handle transient 502/502 from upstream
      let txt = null
      const maxAttempts = 3
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const resp = await fetch(feed.url, { timeout: 15000 })
          if (!resp.ok) throw new Error(`Status code ${resp.status}`)
          txt = await resp.text()
          break
        } catch (e) {
          const wait = 200 * Math.pow(2, attempt)
          console.error(`[threats] fetch attempt ${attempt} for ${feed.name} failed: ${e.message}`)
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, wait))
          else throw e
        }
      }
      if (!txt) throw new Error('Empty response body')
      const parsed = await parser.parseString(txt)
      for (const item of parsed.items ?? []) {
        const id = item.guid || item.link || item.title
        if (!id || seen.has(id)) continue
        const text = `${item.title ?? ''} ${item.contentSnippet ?? ''} ${item.summary ?? ''}`
        if (!matchesKeywords(text, keywords)) continue
        const severity = parseSeverity(text, feed.severity)
        if ((SEVERITY_ORDER[severity] ?? 0) < thresholdLevel) continue

        const title = item.title ?? 'Unknown'
        newThreats.push({
          id,
          title,
          url: item.link ?? '',
          severity,
          source: feed.name,
          date: item.pubDate || item.isoDate || new Date().toISOString(),
          summary: (item.contentSnippet ?? '').slice(0, 400),
          package: extractPackage(title),
        })
        seen.add(id)
      }
      console.log(`[threats] ${feed.name}: +${newThreats.length} fetched`)
      // success: reset failures
      state.failures = 0
      state.disabledUntil = 0
      _feedState.set(feed.url, state)
    } catch (err) {
      console.error(`[threats] Failed to fetch ${feed.name}: ${err.message}`)
      // increment failure counter; if threshold reached, set cooldown
      state.failures = (state.failures || 0) + 1
      const failureThreshold = 3
      const cooldownMin = (loadConfig()?.threats?.feed_cooldown_minutes) || 30
      if (state.failures >= failureThreshold) {
        state.disabledUntil = Date.now() + cooldownMin * 60_000
        console.error(`[threats] Disabling ${feed.name} for ${cooldownMin} minutes after ${state.failures} failures`)
      }
      _feedState.set(feed.url, state)
    }
  }

  saveSeen(seen)
  _cachedThreats = [...newThreats, ..._cachedThreats].slice(0, 200)
  _lastRefresh = Date.now()

  audit('threat.refresh', { new_count: newThreats.length, total: _cachedThreats.length })

  if (broadcast && newThreats.length > 0) {
    broadcast('threats', { count: newThreats.length, threats: newThreats })
  }
  if (broadcast) broadcast('job_done', { job: 'threats', ts: Date.now() })

  return _cachedThreats
}

export function getCachedThreats() {
  return _cachedThreats
}

router.get('/', (req, res) => {
  res.json({ threats: _cachedThreats, lastRefresh: _lastRefresh })
})

router.post('/refresh', async (req, res) => {
  try {
    const threats = await refreshThreats(null)
    res.json({ threats, lastRefresh: _lastRefresh })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/run', (req, res) => {
  const bcast = req.app.locals.broadcast
  setImmediate(() => refreshThreats(bcast).catch(e => console.error('[threats] run:', e.message)))
  res.json({ started: true })
})

export default router
