import { Router } from 'express'
import express from 'express'
import si from 'systeminformation'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'url'
import { path7za } from '7zip-bin'
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

const BACKUP_EXTS = ['.7z', '.7zip']

function getBackupDir() {
  return path.join(getDataDir(), 'backups')
}

function ensureBackupDir() {
  const backupDir = getBackupDir()
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
  return backupDir
}

function listRestoreSources() {
  const backupDir = getBackupDir()
  if (!fs.existsSync(backupDir)) return []
  return fs.readdirSync(backupDir)
    .filter(f => BACKUP_EXTS.some(ext => f.toLowerCase().endsWith(ext)))
    .map(name => {
      const fullPath = path.join(backupDir, name)
      const stat = fs.statSync(fullPath)
      return { name, fullPath, size: stat.size, mtime: stat.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

function run7z(args, opts = {}) {
  const res = spawnSync(path7za, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    const stderr = (res.stderr || '').trim()
    throw new Error(stderr || `7z exited with code ${res.status}`)
  }
  return res.stdout || ''
}

function isTransientDataFile(name) {
  return name === 'backups' || name.endsWith('.lock') || name.endsWith('-wal') || name.endsWith('-shm')
}

function getArchiveEntries() {
  const dataDir = getDataDir()
  const entries = []

  const addPath = (absPath, relPath) => {
    if (!fs.existsSync(absPath)) return
    const stat = fs.statSync(absPath)
    if (stat.isDirectory()) {
      const children = fs.readdirSync(absPath)
      if (children.length === 0) return
      for (const child of children) addPath(path.join(absPath, child), path.join(relPath, child))
      return
    }
    entries.push(relPath)
  }

  for (const name of fs.readdirSync(dataDir)) {
    if (isTransientDataFile(name)) continue
    const absPath = path.join(dataDir, name)
    addPath(absPath, name)
  }

  return entries
}

function buildBackupArchive() {
  const backupDir = ensureBackupDir()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z')
  const archiveName = `claudette-backup-${stamp}.7z`
  const archivePath = path.join(backupDir, archiveName)
  const dataDir = getDataDir()
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudette-backup-'))
  const stagingDir = path.join(workDir, 'data')

  try {
    const db = getDb()
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    fs.mkdirSync(stagingDir, { recursive: true })
    for (const name of getArchiveEntries()) {
      const src = path.join(dataDir, name)
      const dest = path.join(stagingDir, name)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.cpSync(src, dest, { recursive: true })
    }

    const entries = fs.existsSync(stagingDir) ? ['data'] : []
    if (!entries.length) throw new Error('No backup data found')

    run7z(['a', '-t7z', '-mx=9', archivePath, ...entries], { cwd: workDir })
    return { archiveName, archivePath }
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}

function extractBackupArchive(filePath, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true })
  run7z(['x', '-y', `-o${destinationDir}`, filePath], { cwd: destinationDir })
}

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

/** Called by the cron scheduler — saves a backup to data/backups/. */
export function doAutoBackup() {
  try {
    const { archiveName, archivePath } = buildBackupArchive()
    // Prune old auto-backups based on configured retention (default 7 days)
    const backupDir = getBackupDir()
    const keepDays = Math.max(1, loadConfig()?.schedule?.backup_keep_days ?? 7)
    const cutoff = Date.now() - keepDays * 86_400_000
    const all = fs.readdirSync(backupDir).filter(f => f.startsWith('claudette-backup-') && BACKUP_EXTS.some(ext => f.toLowerCase().endsWith(ext)))
    for (const f of all) {
      const stat = fs.statSync(path.join(backupDir, f))
      if (stat.mtimeMs < cutoff) fs.unlinkSync(path.join(backupDir, f))
    }
    audit('backup.auto', { file: archiveName }, 'system')
    console.log(`[backup] Auto-backup saved: ${archiveName} (${(fs.statSync(archivePath).size / 1024).toFixed(1)} KB)`)
  } catch (err) {
    console.error('[backup] Auto-backup failed:', err.message)
  }
}

// ── POST /api/system/backup — create & download a 7z backup ───────────────
router.post('/backup', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { archiveName, archivePath } = buildBackupArchive()
    const size = fs.statSync(archivePath).size
    const mode = String(req.query.mode || 'download')
    audit('backup.created', { size, actor: req.user?.sub ?? 'user', file: archiveName, mode })
    if (mode === 'save') {
      return res.json({ ok: true, file: archiveName, size, mtime: fs.statSync(archivePath).mtimeMs })
    }
    res.setHeader('Content-Type', 'application/x-7z-compressed')
    res.setHeader('X-Backup-Size', String(size))
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`)
    res.sendFile(archivePath)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/system/backup?name=filename — serve an existing backup file (admin only)
router.get('/backup', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const name = path.basename(String(req.query.name || ''))
    if (!name) return res.status(400).json({ error: 'name required' })
    const file = path.join(getBackupDir(), name)
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
    res.download(file)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/system/restore — restore from an uploaded 7z backup ─────────
router.post('/restore', requireAuth, requireRole('admin'), express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  try {
    const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || [])
    const sig = bodyBuf.slice(0, 6)
    const sevenZ = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
    if (sig.length < sevenZ.length || !sig.equals(sevenZ)) {
      return res.status(400).json({ error: 'Invalid backup file — must be a .7z or .7zip archive' })
    }

    const restoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudette-restore-'))
    const uploadPath = path.join(restoreRoot, 'upload.7z')
    fs.writeFileSync(uploadPath, bodyBuf)
    try {
      run7z(['t', uploadPath], { cwd: restoreRoot })
      extractBackupArchive(uploadPath, restoreRoot)
      const extractedDataDir = path.join(restoreRoot, 'data')
      const dbPath = path.join(extractedDataDir, path.basename(getDbPath()))
      const configPath = path.join(extractedDataDir, 'config.yaml')
      if (!fs.existsSync(dbPath) || !fs.existsSync(configPath)) {
        return res.status(400).json({ error: 'Invalid backup file — missing required files' })
      }

      resetDb()
      fs.mkdirSync(path.dirname(getDbPath()), { recursive: true })
      fs.writeFileSync(getConfigPath(), fs.readFileSync(configPath, 'utf8'), 'utf8')
      resetConfig()
      fs.copyFileSync(dbPath, getDbPath())
      for (const suffix of ['-wal', '-shm']) {
        const p = getDbPath() + suffix
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }

      for (const name of ['.jwt_secret', 'ddns-history.json', 'ddns-status.json', 'state.json']) {
        const src = path.join(extractedDataDir, name)
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(getDataDir(), name))
      }

      const themesSrc = path.join(extractedDataDir, 'themes')
      const themesDst = path.join(getDataDir(), 'themes')
      if (fs.existsSync(themesSrc)) fs.cpSync(themesSrc, themesDst, { recursive: true, force: true })
      const evidenceSrc = path.join(extractedDataDir, 'evidence')
      const evidenceDst = path.join(getDataDir(), 'evidence')
      if (fs.existsSync(evidenceSrc)) fs.cpSync(evidenceSrc, evidenceDst, { recursive: true, force: true })

      audit('backup.restored', { created: Date.now(), actor: req.user?.sub ?? 'user' })
      console.log(`[backup] Restore completed from archive ${req.headers['x-filename'] || 'upload'}`)
      res.json({ ok: true, created: Date.now() })
    } finally {
      try { fs.rmSync(restoreRoot, { recursive: true, force: true }) } catch {}
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/system/backups — list available backup bundles (admin only)
router.get('/backups', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const items = listRestoreSources().map(({ name, size, mtime }) => ({ name, size, mtime }))
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
