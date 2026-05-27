import yaml from 'js-yaml'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
let _config = null

// Pulled from package.json — bump the package version to prompt users to review config on next deploy.
export const CONFIG_VERSION = _require('../package.json').version

export function loadConfig() {
  if (_config) return _config

  const candidates = [
    '/app/data/config.yaml',                                    // Docker volume (persists across deploys)
    path.join(__dirname, '..', '..', 'Claudette', 'config.yaml'),
    path.join(__dirname, '..', 'config.yaml'),
    path.join(process.cwd(), 'config.yaml'),
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _config = yaml.load(fs.readFileSync(p, 'utf8'))
      console.log(`[config] Loaded from ${p}`)
      return _config
    }
  }

  console.warn('[config] No config.yaml found — using defaults')
  return {
    pi: { host: '', ssh_user: 'ubuntu' },
    services: [],
    threats: { check_cves: true, keywords: [], severity_threshold: 'medium' },
    schedule: { check_interval_minutes: 5, internet_check_minutes: 5, threat_interval_hours: 6, ping_interval_minutes: 5, speedtest_interval_hours: 1 },
    isp: { name: '', connection_type: 'broadband', expected_uptime: 100, account_number: '', support_email: '' },
    ui: { theme: 'starfield' },
  }
}

export function getConfigPath() {
  // In Docker, save to the persistent data volume so config survives redeploys
  if (fs.existsSync('/app/data')) return '/app/data/config.yaml'
  return path.join(process.cwd(), 'config.yaml')
}

export function resetConfig() {
  _config = null
}

export function getJwtSecret() {
  const secretPath = fs.existsSync('/app/data')
    ? '/app/data/.jwt_secret'
    : path.join(process.cwd(), 'data', '.jwt_secret')
  if (!fs.existsSync(secretPath)) {
    const dir = path.dirname(secretPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const secret = crypto.randomBytes(64).toString('hex')
    fs.writeFileSync(secretPath, secret, { mode: 0o600 })
    return secret
  }
  return fs.readFileSync(secretPath, 'utf8').trim()
}
