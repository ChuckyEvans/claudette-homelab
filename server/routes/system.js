import { Router } from 'express'
import express from 'express'
import si from 'systeminformation'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { getDb, getDbPath, getDataDir, resetDb, audit } from '../db.js'
import { getConfigPath, resetConfig } from '../config.js'

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
    const results = ifaces
      .filter(i => i.ip4 && !i.internal && i.ip4 !== '127.0.0.1')
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
  return JSON.stringify({
    app:     'claudette',
    version: '1',
    created: Date.now(),
    config:  configData,
    db:      dbData.toString('base64'),
  })
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
    const fname = `claudette-backup-${localDateStr()}-${Date.now()}.claudette`
    fs.writeFileSync(path.join(backupDir, fname), bundle)
    // Delete auto-backups older than 7 days
    const cutoff = Date.now() - 7 * 86_400_000
    const all = fs.readdirSync(backupDir).filter(f => f.endsWith('.claudette'))
    for (const f of all) {
      const stat = fs.statSync(path.join(backupDir, f))
      if (stat.mtimeMs < cutoff) fs.unlinkSync(path.join(backupDir, f))
    }
    audit('backup.auto', { file: fname }, 'system')
    console.log(`[backup] Auto-backup saved: ${fname}`)
  } catch (err) {
    console.error('[backup] Auto-backup failed:', err.message)
  }
}

// ── POST /api/system/backup — create & download a backup bundle ───────────────
router.post('/backup', (req, res) => {
  try {
    const bundle   = buildBackupBundle()
    const filename = `claudette-backup-${localDateStr()}.claudette`
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(bundle)
    audit('backup.created', { size: bundle.length, actor: req.user?.sub ?? 'user' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/system/restore — restore from an uploaded backup bundle ─────────
// Accepts the JSON bundle as a raw body (up to 50 MB).
router.post('/restore', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  try {
    let bundle
    try {
      bundle = JSON.parse(req.body.toString('utf8'))
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

export default router
