import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'claudette.db')

export function getDbPath()   { return DB_PATH }
export function getDataDir()  { return DATA_DIR }
export function resetDb() {
  if (_db) { try { _db.close() } catch {} _db = null }
  // Delete stale WAL/SHM files so the restored database opens cleanly
  try { if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal') } catch {}
  try { if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm') } catch {}
}

let _db = null

export function getDb() {
  if (_db) return _db

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  _db = new Database(DB_PATH)

  _db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS audit_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      INTEGER NOT NULL,
      event   TEXT    NOT NULL,
      actor   TEXT    NOT NULL DEFAULT 'system',
      payload TEXT    NOT NULL DEFAULT '{}',
      ip      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ts    ON audit_log (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log (event);

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_labels (
      mac        TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  // ── Devices table: MAC is the primary key ────────────────────────────────
  const tableExists = _db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'").length > 0

  if (!tableExists) {
    // Fresh install
    _db.exec(`
      CREATE TABLE devices (
        mac            TEXT PRIMARY KEY,
        ip             TEXT NOT NULL,
        vendor         TEXT,
        hostname       TEXT,
        hostname_stale INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'offline',
        first_seen   INTEGER NOT NULL,
        last_seen    INTEGER,
        last_online  INTEGER,
        updated_at   INTEGER,
        latency      INTEGER,
        os           TEXT,
        ports        TEXT NOT NULL DEFAULT '[]',
        host_scripts TEXT NOT NULL DEFAULT '[]',
        traceroute   TEXT NOT NULL DEFAULT '[]',
        favorited    INTEGER NOT NULL DEFAULT 0,
        flagged      INTEGER NOT NULL DEFAULT 0,
        dormant      INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX idx_devices_ip     ON devices (ip);
      CREATE        INDEX idx_devices_status ON devices (status);
    `)
  } else {
    // Migrate if still on old ip-as-PK schema
    const pkCol = _db.all('PRAGMA table_info(devices)').find(c => c.pk === 1)
    if (pkCol?.name === 'ip') {
      console.log('[db] Migrating devices table to mac-primary-key schema…')
      _db.exec(`
        CREATE TABLE devices_v2 (
          mac          TEXT PRIMARY KEY,
          ip           TEXT NOT NULL,
          vendor       TEXT,
          hostname     TEXT,
          status       TEXT NOT NULL DEFAULT 'offline',
          first_seen   INTEGER NOT NULL,
          last_seen    INTEGER,
          updated_at   INTEGER,
          latency      INTEGER,
          os           TEXT,
          ports        TEXT NOT NULL DEFAULT '[]',
          host_scripts TEXT NOT NULL DEFAULT '[]',
          traceroute   TEXT NOT NULL DEFAULT '[]'
        );
        INSERT OR IGNORE INTO devices_v2
          SELECT COALESCE(mac, 'noMAC:' || ip), ip, vendor, hostname,
                 status, first_seen, last_seen, last_seen, latency, os,
                 ports, host_scripts, traceroute
          FROM devices;
        DROP TABLE devices;
        ALTER TABLE devices_v2 RENAME TO devices;
        CREATE UNIQUE INDEX idx_devices_ip     ON devices (ip);
        CREATE        INDEX idx_devices_status ON devices (status);
      `)
      console.log('[db] Migration complete.')
    }
    // Ensure indexes exist (idempotent)
    _db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_ip     ON devices (ip);
      CREATE        INDEX IF NOT EXISTS idx_devices_status ON devices (status);
    `)
    // Add updated_at column if missing (upgrade from older schema)
    const cols = _db.all('PRAGMA table_info(devices)').map(c => c.name)
    if (!cols.includes('updated_at')) {
      _db.exec('ALTER TABLE devices ADD COLUMN updated_at INTEGER')
      _db.exec('UPDATE devices SET updated_at = last_seen WHERE updated_at IS NULL')
      console.log('[db] Added updated_at column to devices.')
    }
    if (!cols.includes('hostname_stale')) {
      _db.exec('ALTER TABLE devices ADD COLUMN hostname_stale INTEGER NOT NULL DEFAULT 0')
      console.log('[db] Added hostname_stale column to devices.')
    }
    if (!cols.includes('last_online')) {
      _db.exec('ALTER TABLE devices ADD COLUMN last_online INTEGER')
      // Seed last_online from last_seen for devices that are currently online/filtered
      _db.exec("UPDATE devices SET last_online = last_seen WHERE status IN ('online','filtered')")
      console.log('[db] Added last_online column to devices.')
    }
    if (!cols.includes('favorited')) {
      _db.exec('ALTER TABLE devices ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0')
      console.log('[db] Added favorited column to devices.')
    }
    if (!cols.includes('flagged')) {
      _db.exec('ALTER TABLE devices ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0')
      console.log('[db] Added flagged column to devices.')
    }
    if (!cols.includes('dormant')) {
      _db.exec('ALTER TABLE devices ADD COLUMN dormant INTEGER NOT NULL DEFAULT 0')
      console.log('[db] Added dormant column to devices.')
    }
  }

  // Device lifecycle events (online/offline/new device/port discovery)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS device_events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      ts       INTEGER NOT NULL,
      event    TEXT NOT NULL,
      mac      TEXT,
      ip       TEXT,
      hostname TEXT,
      payload  TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_dev_events_ts  ON device_events (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_dev_events_mac ON device_events (mac);
    CREATE INDEX IF NOT EXISTS idx_dev_events_evt ON device_events (event);
  `)

  // Speed test results
  _db.exec(`
    CREATE TABLE IF NOT EXISTS speedtest_results (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      ts               INTEGER NOT NULL,
      client_ip        TEXT,
      client_isp       TEXT,
      client_city      TEXT,
      client_country   TEXT,
      client_lat       REAL,
      client_lon       REAL,
      server_host      TEXT,
      server_name      TEXT,
      server_location  TEXT,
      server_country   TEXT,
      ping_ms          REAL,
      download_mbps    REAL,
      upload_mbps      REAL,
      error            TEXT,
      via              TEXT NOT NULL DEFAULT 'direct'
    );
    CREATE INDEX IF NOT EXISTS idx_speedtest_ts ON speedtest_results (ts DESC);
  `)

  // Add via column to speedtest_results for direct/vpn tracking (migration for existing installs)
  const stCols = _db.all("PRAGMA table_info(speedtest_results)").map(c => c.name)
  if (!stCols.includes('via')) {
    _db.exec("ALTER TABLE speedtest_results ADD COLUMN via TEXT NOT NULL DEFAULT 'direct'")
    console.log('[db] Added via column to speedtest_results.')
  }

  console.log(`[db] SQLite ready at ${DB_PATH}`)
  return _db
}

/**
 * Write one audit record synchronously.
 * @param {string} event   - dot-namespaced event type, e.g. 'scan.complete'
 * @param {object} payload - arbitrary JSON-serialisable data
 * @param {string} actor   - 'system' | 'user'
 * @param {string|null} ip - client IP for user-triggered events
 */
export function audit(event, payload = {}, actor = 'system', ip = null) {
  try {
    getDb().run(
      'INSERT INTO audit_log (ts, event, actor, payload, ip) VALUES (?, ?, ?, ?, ?)',
      [Date.now(), event, actor, JSON.stringify(payload), ip]
    )
  } catch (err) {
    console.error('[audit] write failed:', err.message)
  }
}

/** Record a device lifecycle event (online/offline/new/port change). */
export function auditDevice(event, mac, ip, hostname, payload = {}) {
  try {
    getDb().run(
      'INSERT INTO device_events (ts, event, mac, ip, hostname, payload) VALUES (?, ?, ?, ?, ?, ?)',
      [Date.now(), event, mac ?? null, ip ?? null, hostname ?? null, JSON.stringify(payload)]
    )
  } catch (err) {
    console.error('[auditDevice] write failed:', err.message)
  }
}

/** Delete audit_log and device_events entries older than retentionDays. */
export function pruneOldData(retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const db = getDb()
  db.run('DELETE FROM audit_log    WHERE ts < ?', [cutoff])
  db.run('DELETE FROM device_events WHERE ts < ?', [cutoff])
}

export function upsertDevice(device) {
  const now = Date.now()
  const db = getDb()
  const pk = device.mac ?? `noMAC:${device.ip}`

  // When a real MAC is discovered for a device previously stored without one, remove the placeholder
  if (device.mac) {
    db.run("DELETE FROM devices WHERE mac = ?", [`noMAC:${device.ip}`])
  }

  // If another device previously held this IP (DHCP reassignment), evict it first
  db.run("DELETE FROM devices WHERE ip = ? AND mac != ?", [device.ip, pk])

  const isActive = device.status === 'online' || device.status === 'filtered'
  const effectiveStatus = device.status === 'online' ? 'online' : device.status === 'filtered' ? 'filtered' : 'offline'

  db.run(`
    INSERT INTO devices (mac, ip, vendor, hostname, hostname_stale, status, first_seen, last_seen, last_online, updated_at, latency, os, ports, host_scripts, traceroute)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mac) DO UPDATE SET
      ip             = excluded.ip,
      vendor         = COALESCE(excluded.vendor,   devices.vendor),
      hostname       = COALESCE(excluded.hostname, devices.hostname),
      hostname_stale = CASE
                         WHEN excluded.hostname IS NOT NULL THEN 0
                         WHEN devices.hostname  IS NOT NULL THEN 1
                         ELSE 0
                       END,
      status         = excluded.status,
      last_seen      = excluded.last_seen,
      last_online    = CASE WHEN excluded.last_online IS NOT NULL THEN excluded.last_online ELSE devices.last_online END,
      updated_at     = excluded.updated_at,
      latency        = excluded.latency,
      os             = COALESCE(excluded.os,       devices.os),
      dormant        = CASE WHEN excluded.status IN ('online','filtered') THEN 0 ELSE devices.dormant END,
      ports        = CASE WHEN json_array_length(excluded.ports)        > 0 THEN excluded.ports        ELSE devices.ports        END,
      host_scripts = CASE WHEN json_array_length(excluded.host_scripts) > 0 THEN excluded.host_scripts ELSE devices.host_scripts END,
      traceroute   = CASE WHEN json_array_length(excluded.traceroute)   > 0 THEN excluded.traceroute   ELSE devices.traceroute   END
  `, [
    pk, device.ip, device.vendor ?? null, device.hostname ?? null, 0,
    effectiveStatus,
    now, now, isActive ? now : null, now,
    device.latency ?? null, device.os ?? null,
    JSON.stringify(device.ports ?? []),
    JSON.stringify(device.hostScripts ?? []),
    JSON.stringify(device.traceroute ?? []),
  ])
}

export function clearAllDevices() {
  getDb().run('DELETE FROM devices')
}

/**
 * Remove phantom entries — IPs that were bulk-inserted by the old scan
 * behaviour but never actually responded to any probe.
 *
 * A device is a phantom if ALL of the following are true:
 *   1. mac starts with 'noMAC:' — nmap never got an ARP reply, meaning
 *      the host never responded at all (a real device always yields a MAC
 *      on the local subnet via ARP, or via a port scan on remote subnets).
 *   2. last_online IS NULL — never seen as online or filtered.
 *   3. ports = '[]' — no port data discovered.
 *
 * Once a device has a real MAC address it is kept forever — MACs are our
 * source of truth and survive IP changes (DHCP reassignment).
 */
export function clearPhantomDevices() {
  const db = getDb()
  const phantoms = db.all(
    "SELECT mac, ip FROM devices WHERE mac LIKE 'noMAC:%' AND last_online IS NULL AND ports = '[]'"
  )
  if (phantoms.length) {
    db.run(
      "DELETE FROM devices WHERE mac LIKE 'noMAC:%' AND last_online IS NULL AND ports = '[]'"
    )
    console.log(`[db] Pruned ${phantoms.length} phantom offline device(s)`)
  }
  return phantoms
}

export function clearDevicePorts(mac) {
  getDb().run(
    "UPDATE devices SET ports = '[]', host_scripts = '[]', traceroute = '[]' WHERE mac = ?",
    [mac]
  )
}

/** Mark devices offline and return the array of {mac, ip, hostname} that actually changed. */
export function markOffline(keepMacs) {
  const db = getDb()
  let wentOffline
  if (!keepMacs.length) {
    wentOffline = db.all("SELECT mac, ip, hostname FROM devices WHERE status IN ('online','filtered')")
    db.run("UPDATE devices SET status = 'offline' WHERE status IN ('online','filtered')")
  } else {
    const ph = keepMacs.map(() => '?').join(',')
    wentOffline = db.all(`SELECT mac, ip, hostname FROM devices WHERE status IN ('online','filtered') AND mac NOT IN (${ph})`, keepMacs)
    db.run(`UPDATE devices SET status = 'offline' WHERE status IN ('online','filtered') AND mac NOT IN (${ph})`, keepMacs)
  }
  return wentOffline
}

export function touchDeviceStatus(mac, status, latency) {
  const now = Date.now()
  if (status === 'online') {
    getDb().run('UPDATE devices SET status = ?, latency = ?, last_seen = ? WHERE mac = ?', [status, latency ?? null, now, mac])
  } else {
    getDb().run("UPDATE devices SET status = 'offline' WHERE mac = ?", [mac])
  }
}

export function getAllDevices() {
  return getDb().all(`
    SELECT d.*, dl.label
    FROM devices d
    LEFT JOIN device_labels dl ON dl.mac = d.mac
    ORDER BY d.ip
  `).map(r => ({
    ip: r.ip,
    mac: r.mac?.startsWith('noMAC:') ? null : r.mac,
    vendor: r.vendor, hostname: r.hostname, hostnameStale: r.hostname_stale === 1,
    label: r.label ?? null,
    status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen,
    lastOnline: r.last_online ?? null,
    updatedAt: r.updated_at ?? null,
    favorited: r.favorited === 1,
    flagged:   r.flagged   === 1,
    dormant:   r.dormant   === 1,
    latency: r.latency, os: r.os,
    ports: JSON.parse(r.ports || '[]'),
    hostScripts: JSON.parse(r.host_scripts || '[]'),
    traceroute: JSON.parse(r.traceroute || '[]'),
  }))
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function userExists() {
  return (getDb().get('SELECT COUNT(*) as c FROM users').c ?? 0) > 0
}

export function createUser(username, passwordHash) {
  getDb().run(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
    [username, passwordHash, Date.now()]
  )
}

export function findUserByUsername(username) {
  return getDb().get('SELECT * FROM users WHERE username = ?', [username]) ?? null
}

// ── Device labels (keyed by MAC — survives IP changes) ────────────────────────

export function setDeviceLabel(mac, label) {
  if (!label || !label.trim()) {
    getDb().run('DELETE FROM device_labels WHERE mac = ?', [mac])
  } else {
    getDb().run(
      'INSERT INTO device_labels (mac, label, updated_at) VALUES (?, ?, ?) ON CONFLICT(mac) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at',
      [mac, label.trim(), Date.now()]
    )
  }
}

export function getDeviceLabel(mac) {
  return getDb().get('SELECT label FROM device_labels WHERE mac = ?', [mac])?.label ?? null
}

export function toggleFavorite(mac) {
  getDb().run(
    'UPDATE devices SET favorited = CASE WHEN favorited = 1 THEN 0 ELSE 1 END WHERE mac = ?',
    [mac]
  )
  return getDb().get('SELECT favorited FROM devices WHERE mac = ?', [mac])?.favorited === 1
}

export function toggleFlagged(mac) {
  getDb().run(
    'UPDATE devices SET flagged = CASE WHEN flagged = 1 THEN 0 ELSE 1 END WHERE mac = ?',
    [mac]
  )
  return getDb().get('SELECT flagged FROM devices WHERE mac = ?', [mac])?.flagged === 1
}

export function toggleDormant(mac) {
  getDb().run(
    'UPDATE devices SET dormant = CASE WHEN dormant = 1 THEN 0 ELSE 1 END WHERE mac = ?',
    [mac]
  )
  return getDb().get('SELECT dormant FROM devices WHERE mac = ?', [mac])?.dormant === 1
}

/**
 * Auto-dormant devices that have been offline for >= `days` days.
 * Only transitions dormant=0 → 1; never clears manually-set dormant.
 * Returns the number of devices newly marked dormant.
 */
export function autoDormantStale(days = 3) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const result = getDb().run(
    `UPDATE devices SET dormant = 1
     WHERE dormant = 0
       AND status = 'offline'
       AND (last_online IS NOT NULL AND last_online < ? OR last_online IS NULL AND first_seen < ?)`,
    [cutoff, cutoff]
  )
  return result.changes ?? 0
}
