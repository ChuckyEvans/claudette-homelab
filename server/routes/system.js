import { Router } from 'express'
import express from 'express'
import si from 'systeminformation'
import os from 'os'
import fs from 'fs'
import path from 'path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'url'
import { getDb, getDbPath, getDataDir, resetDb, audit } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getConfigPath, loadConfig, resetConfig } from '../config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read version from package.json once at startup
const { version: CURRENT_VERSION } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
)

// Cache the GitHub release check for 1 hour to avoid rate limits
let _versionCache = null
let _versionCacheAt = 0
const VERSION_CACHE_MS = 60 * 60 * 1000
// Build timestamp (can be provided at Docker build time via BUILD_TIME arg)
const BUILD_TIME = process.env.BUILD_TIME || null

const router = Router()

router.get('/stats', async (req, res) => {
  try {
    const [cpuLoad, mem, disk, net, osData, cpuStatic] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
      si.cpu(),
    ])

    res.json({
      cpu: {
        load: Math.round(cpuLoad.currentLoad),
        cores: cpuLoad.cpus?.length ?? os.cpus().length,
        model: cpuStatic.manufacturer
          ? `${cpuStatic.manufacturer} ${cpuStatic.brand}`
          : cpuStatic.brand || 'Unknown',
        perCore: cpuLoad.cpus?.map(c => Math.round(c.load)) ?? [],
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        percent: Math.round((mem.used / mem.total) * 100),
      },
      disk: Object.values(
        disk
          .filter(d => d.size > 0)
          .reduce((acc, d) => {
            // Deduplicate by underlying fs device — keep shortest mount path
            if (!acc[d.fs] || d.mount.length < acc[d.fs].mount.length) acc[d.fs] = d
            return acc
          }, {})
      ).map(d => ({
        fs: d.fs,
        size: d.size,
        used: d.used,
        use: Math.round(d.use),
        mount: d.mount,
        type: d.type,
      })),
      network: net.slice(0, 4).map(n => ({
        iface: n.iface,
        rx_bytes: n.rx_bytes,
        tx_bytes: n.tx_bytes,
        rx_sec: Math.max(0, Math.round(n.rx_sec ?? 0)),
        tx_sec: Math.max(0, Math.round(n.tx_sec ?? 0)),
      })),
      os: {
        distro: osData.distro,
        release: osData.release,
        hostname: osData.hostname,
        arch: osData.arch,
        platform: osData.platform,
        kernel: osData.kernel,
        uptime: Math.floor(os.uptime()),
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/system/interfaces — returns network interfaces with IPs & derived subnets
// Used by the wizard and settings to auto-detect the host IP and scan ranges.
router.get('/interfaces', async (req, res) => {
  try {
    const ifaces = await si.networkInterfaces()
    const VIRTUAL_IFACE = /^(docker|veth|br-|virbr|vmnet|vbox|lo|vEthernet|Loopback|isatap|Teredo)/i
    const results = ifaces
      .filter(i => {
        if (!i.ip4 || i.internal || i.ip4 === '127.0.0.1') return false
        if (VIRTUAL_IFACE.test(i.iface)) return false
        // Exclude Docker-range IPs (172.16-31.x.x) and link-local (169.254.x.x)
        const first = parseInt(i.ip4.split('.')[0])
        const second = parseInt(i.ip4.split('.')[1])
        if (first === 169 && second === 254) return false
        if (first === 172 && second >= 16 && second <= 31) return false
        return true
      })
      .map(i => {
        const prefix = i.ip4_subnet
          ? Math.round(Math.log2(
              0x100000000 -
              i.ip4_subnet.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0
            ))
          : i.prefixLength ?? 24
        // Derive network address
        const parts = i.ip4.split('.').map(Number)
        const mask  = prefix >= 24 ? [255, 255, 255, 0]
                    : prefix >= 16 ? [255, 255, 0, 0]
                    : prefix >= 8  ? [255, 0, 0, 0]
                    : [0, 0, 0, 0]
        const net = parts.map((p, idx) => p & mask[idx]).join('.')
        return {
          iface:  i.iface,
          ip:     i.ip4,
          subnet: `${net}/${prefix}`,
        }
      })
    res.json({ interfaces: results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Backup helpers ────────────────────────────────────────────────────────────

function buildBackupBundle() {
  const db = getDb()
  // Flush WAL into the main database file for a consistent snapshot
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const dbData     = fs.readFileSync(getDbPath())
  const configPath = getConfigPath()
  const configData = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  const json = JSON.stringify({
    app:     'claudette',
    version: '1',
    created: Date.now(),
    config:  configData,
    db:      dbData.toString('base64'),
  })
  // Gzip-compress: base64 SQLite + JSON wrapper compresses ~85-90%
  return zlib.gzipSync(Buffer.from(json, 'utf8'))
}

function localDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

/** Called by the cron scheduler — saves a backup to data/backups/. */
export function doAutoBackup() {
  try {
    const bundle    = buildBackupBundle()
    const backupDir = path.join(getDataDir(), 'backups')
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
    const fname = `claudette-backup-${localDateStr()}-${Date.now()}.claudette.gz`
    fs.writeFileSync(path.join(backupDir, fname), bundle)
    // Prune old auto-backups based on configured retention (default 7 days)
    const keepDays = Math.max(1, loadConfig()?.schedule?.backup_keep_days ?? 7)
    const cutoff = Date.now() - keepDays * 86_400_000
    const all = fs.readdirSync(backupDir).filter(f => f.startsWith('claudette-backup-'))
    for (const f of all) {
      const stat = fs.statSync(path.join(backupDir, f))
      if (stat.mtimeMs < cutoff) fs.unlinkSync(path.join(backupDir, f))
    }
    audit('backup.auto', { file: fname }, 'system')
    console.log(`[backup] Auto-backup saved: ${fname} (${(bundle.length / 1024).toFixed(1)} KB)`)
  } catch (err) {
    console.error('[backup] Auto-backup failed:', err.message)
  }
}

// ── POST /api/system/backup — create & download a backup bundle ───────────────
router.post('/backup', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const bundle   = buildBackupBundle()
    const filename = `claudette-backup-${localDateStr()}.claudette.gz`
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(bundle)
    audit('backup.created', { size: bundle.length, actor: req.user?.sub ?? 'user' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/system/backup?name=filename — serve an existing backup file (admin only)
router.get('/backup', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.status(400).json({ error: 'name required' })
    const backupDir = path.join(getDataDir(), 'backups')
    const file = path.join(backupDir, path.basename(name))
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
    res.download(file)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/system/restore — restore from an uploaded backup bundle ─────────
// Accepts the JSON bundle as a raw body (up to 50 MB).
router.post('/restore', requireAuth, requireRole('admin'), express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  try {
    let bodyBuf = req.body
    // Require gzip — detect magic bytes 1f 8b
    if (bodyBuf[0] !== 0x1f || bodyBuf[1] !== 0x8b) {
      return res.status(400).json({ error: 'Invalid backup file — must be a .claudette.gz file' })
    }
    try { bodyBuf = zlib.gunzipSync(bodyBuf) } catch {
      return res.status(400).json({ error: 'Invalid backup file — could not decompress' })
    }
    let bundle
    try {
      bundle = JSON.parse(bodyBuf.toString('utf8'))
    } catch {
      return res.status(400).json({ error: 'Invalid backup file — could not parse JSON' })
    }

    if (bundle.app !== 'claudette' || bundle.version !== '1' || !bundle.db || !bundle.config) {
      return res.status(400).json({ error: 'Invalid backup file — missing required fields' })
    }

    // Decode the database binary
    let dbBuf
    try {
      dbBuf = Buffer.from(bundle.db, 'base64')
    } catch {
      return res.status(400).json({ error: 'Invalid backup file — database data is corrupt' })
    }
    if (dbBuf.length < 100) {
      return res.status(400).json({ error: 'Invalid backup file — database too small' })
    }

    // Verify SQLite magic bytes (first 16 bytes = "SQLite format 3\0")
    const magic = dbBuf.slice(0, 15).toString('ascii')
    if (magic !== 'SQLite format 3') {
      return res.status(400).json({ error: 'Invalid backup file — not a valid SQLite database' })
    }

    // Write config first (safe even if DB write fails)
    const configPath = getConfigPath()
    fs.writeFileSync(configPath, bundle.config, 'utf8')
    resetConfig()

    // Close DB connection, overwrite database file, reopen on next access
    resetDb()
    fs.writeFileSync(getDbPath(), dbBuf)

    audit('backup.restored', { created: bundle.created, actor: req.user?.sub ?? 'user' })
    console.log(`[backup] Restore completed — backup was from ${new Date(bundle.created).toLocaleString('en-GB')}`)

    res.json({ ok: true, created: bundle.created })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/system/backups — list available backup bundles (admin only)
router.get('/backups', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const backupDir = path.join(getDataDir(), 'backups')
    if (!fs.existsSync(backupDir)) return res.json({ items: [] })
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.claudette.gz') || f.startsWith('claudette-backup-'))
    const items = files.map(f => {
      const p = path.join(backupDir, f)
      const s = fs.statSync(p)
      return { name: f, size: s.size, mtime: s.mtimeMs }
    }).sort((a,b) => b.mtime - a.mtime)
    res.json({ items })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Version / update check ───────────────────────────────────────────────────
router.get('/version', async (req, res) => {
  const now = Date.now()
  const force = req.query.force === '1'
  if (!force && _versionCache && now - _versionCacheAt < VERSION_CACHE_MS) {
    return res.json(_versionCache)
  }
  try {
    const ghRes = await fetch(
      'https://api.github.com/repos/ChuckyEvans/claudette-homelab/releases/latest',
      { headers: { 'User-Agent': 'claudette-homelab' }, signal: AbortSignal.timeout(8000) }
    )
    if (!ghRes.ok) throw new Error(`GitHub ${ghRes.status}`)
    const data = await ghRes.json()
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    const updateAvailable = latest && latest !== CURRENT_VERSION
    _versionCache = {
      current: CURRENT_VERSION,
      latest: latest || CURRENT_VERSION,
      updateAvailable,
      releaseUrl: updateAvailable ? (data.html_url ?? null) : null,
      build_time: BUILD_TIME,
    }
    _versionCacheAt = now
  } catch {
    // Return current version even when GitHub is unreachable
    _versionCache = { current: CURRENT_VERSION, latest: null, updateAvailable: false, releaseUrl: null, error: 'unreachable', build_time: BUILD_TIME }
    _versionCacheAt = now
  }
  res.json(_versionCache)
})

export default router
