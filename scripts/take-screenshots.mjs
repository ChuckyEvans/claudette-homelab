/**
 * Takes full-resolution screenshots of every page for the README.
 * Usage: node scripts/take-screenshots.mjs [base-url]
 * Default base URL: http://192.168.8.10:7654
 *
 * Env vars:
 *   CLAUDETTE_USER  login username  (default: admin)
 *   CLAUDETTE_PASS  login password  (required)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const BASE   = process.argv[2] ?? 'http://192.168.8.10:7654'
const CREDENTIALS = {
  user: process.env.CLAUDETTE_USER ?? 'admin',
  pass: process.env.CLAUDETTE_PASS ?? '',
}
const OUTDIR = resolve('docs/screenshots')
mkdirSync(OUTDIR, { recursive: true })

const W = 1440
const H = 900

// ── Sensitive-data redaction ──────────────────────────────────────────────────
// Injects CSS blur onto elements that contain IPs, MACs, emails, DDNS hostnames,
// input values, and the sidebar username.  Run before every screenshot.
async function redact(page) {
  await page.evaluate(() => {
    if (document.getElementById('__rdt_style')) return  // idempotent

    const style = document.createElement('style')
    style.id = '__rdt_style'
    // Text-node blur (spans, divs, etc.)
    // Input blur — filter doesn't work on input internals in Chromium;
    // use transparent colour + blurred text-shadow instead.
    style.textContent = `
      ._rdt { filter: blur(5px) !important; user-select: none !important; }
    `
    document.head.appendChild(style)

    const PATTERNS = [
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/, // IPv4
      /\b[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}\b/,                                       // MAC
      /[^\s@]+@[^\s@]+\.[^\s@]{2,}/,                                                     // email
      /\b[a-z0-9-]+\.(hopto|duckdns|ddns|dynalias|freedns|no-ip|noip|dyndns|afraid)\.(org|net|com|io)\b/i, // DDNS
    ]
    const isSensitive = t => PATTERNS.some(p => p.test(t))

    // Walk text nodes and blur the nearest leaf ancestor
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const hits = []
    let n
    while ((n = walker.nextNode())) {
      if (n.textContent.trim() && isSensitive(n.textContent)) hits.push(n)
    }
    for (const n of hits) {
      const el = n.parentElement
      if (el && !el.closest('._rdt')) el.classList.add('_rdt')
    }

    // Blur ALL non-empty inputs — overlay approach (CSS on input internals is unreliable in Chromium)
    for (const inp of document.querySelectorAll('input')) {
      if (!inp.value || !inp.value.trim()) continue
      const rect = inp.getBoundingClientRect()
      if (rect.width === 0) continue
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        `position:fixed`,
        `left:${rect.left + 1}px`,
        `top:${rect.top + 1}px`,
        `width:${rect.width - 2}px`,
        `height:${rect.height - 2}px`,
        `background:rgba(10,10,20,0.82)`,
        `border-radius:5px`,
        `z-index:99999`,
        `display:flex`,
        `align-items:center`,
        `padding:0 10px`,
        `color:rgba(148,163,184,0.35)`,
        `font-size:13px`,
        `letter-spacing:3px`,
        `pointer-events:none`,
      ].join(';')
      overlay.textContent = '•'.repeat(Math.max(6, Math.min(20, inp.value.length)))
      document.body.appendChild(overlay)
    }

    // Blur sidebar username (short single-token text inside <aside>)
    for (const span of document.querySelectorAll('aside span, aside div')) {
      const t = span.textContent.trim()
      if (t && t.length < 32 && !/\s/.test(t) && !/^(All|Claudette|Homelab)/i.test(t)
          && span.children.length === 0) {
        span.classList.add('_rdt')
      }
    }
  })
}

async function shot(page, name) {
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUTDIR}/${name}.png`, clip: { x: 0, y: 0, width: W, height: H } })
  console.log(`  ✓ ${name}.png`)
}

async function nav(page, label) {
  // prefer nav-scoped button to avoid ambiguity with inner tab buttons
  await page.locator('nav').locator(`button:has-text("${label}")`).click()
  await page.waitForTimeout(400)
}

;(async () => {
  console.log(`Taking screenshots from ${BASE} at ${W}×${H}…`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  })

  // Apply dark theme before the page loads (read by app's IIFE on startup)
  const baseUrl = new URL(BASE)
  await context.addCookies([{
    name:    'claudette_ui_theme',
    value:   'dark',
    domain:  baseUrl.hostname,
    path:    '/',
    expires: Math.floor(new Date('2099-01-01').getTime() / 1000),
  }])

  const page = await context.newPage()

  // ── Login ─────────────────────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2000)

  // If login form is present, authenticate (username + password)
  const passwordField = page.locator('input[type="password"]').first()
  if (await passwordField.isVisible({ timeout: 3000 }).catch(() => false)) {
    const usernameField = page.locator('input[type="text"]').first()
    if (await usernameField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await usernameField.fill(CREDENTIALS.user)
    }
    await passwordField.fill(CREDENTIALS.pass)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForTimeout(3000)
  }

  await page.waitForTimeout(1500)

  // ── Network ───────────────────────────────────────────────────────────────
  await nav(page, 'Network')
  await shot(page, 'network')

  // ── Dashboard ─────────────────────────────────────────────────────────────
  await nav(page, 'Dashboard')
  await shot(page, 'dashboard')

  // ── Exposure ──────────────────────────────────────────────────────────────
  await nav(page, 'Exposure')
  await shot(page, 'exposure')

  // ── System ────────────────────────────────────────────────────────────────
  await nav(page, 'System')
  await shot(page, 'system')

  // Reports — Overview tab ────────────────────────────────────────────────
  await nav(page, 'Reports')
  await shot(page, 'reports-overview')

  // Reports — Internet tab (click 90d for full history)
  const internetTab = page.locator('main >> button:has-text("Internet")').first()
  if (await internetTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await internetTab.click()
    await page.waitForTimeout(800)
    const btn90 = page.locator('main >> button:has-text("90d")').first()
    if (await btn90.isVisible({ timeout: 1000 }).catch(() => false)) await btn90.click()
    await shot(page, 'reports-internet')
  }

  // Reports — Speed Test tab (click 90d for full history)
  const speedTab = page.locator('main >> button:has-text("Speed")').first()
  if (await speedTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await speedTab.click()
    await page.waitForTimeout(800)
    const btn90s = page.locator('main >> button:has-text("90d")').first()
    if (await btn90s.isVisible({ timeout: 1000 }).catch(() => false)) await btn90s.click()
    await shot(page, 'reports-speed')
  }

  // ── Audit Log ─────────────────────────────────────────────────────────────
  await nav(page, 'Audit Log')
  await shot(page, 'audit-log')

  // ── Logs ──────────────────────────────────────────────────────────────────
  await nav(page, 'Logs')
  await shot(page, 'logs')

  // ── Settings ──────────────────────────────────────────────────────────────
  await nav(page, 'Settings')
  await shot(page, 'settings')

  await browser.close()
  console.log(`\nDone — ${OUTDIR}`)
})()
