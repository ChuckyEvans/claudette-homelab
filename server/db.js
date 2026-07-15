import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')

// Allow overriding DB path via config.yaml `dbPath` entry. Falling back to data/claudette.db.
let configuredPath = null
try {
  const cfg = loadConfig()
  if (cfg && cfg.dbPath) configuredPath = cfg.dbPath
} catch {
  // ignore — we'll use defaults
}

// Use a per-process test DB when running under Vitest to avoid cross-worker locks
// Vitest sets VITEST_WORKER_ID (0,1,2...) — if absent but NODE_ENV==='test' use PID
const vitestWorker = process.env.VITEST_WORKER_ID ?? (process.env.NODE_ENV === 'test' ? String(process.pid) : null)
const DB_PATH = vitestWorker
  ? (configuredPath ? configuredPath.replace(/\.db$/, `.test.${vitestWorker}.db`) : path.join(DATA_DIR, `claudette.test.${vitestWorker}.db`))
  : (configuredPath ? configuredPath : path.join(DATA_DIR, 'claudette.db'))

export function getDbPath()   { return DB_PATH }
export function getDataDir()  { return DATA_DIR }
export function resetDb() {
  if (_db) { try { _db.close() } catch {} _db = null }
  // Delete stale WAL/SHM files so the restored database opens cleanly
  try { if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal') } catch {}
  try { if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm') } catch {}
  // Delete stale node-sqlite3-wasm lock directory left over from a hard shutdown
  try {
    const lockDir = DB_PATH + '.lock'
    if (fs.existsSync(lockDir)) fs.rmdirSync(lockDir)
  } catch {}
}

let _db = null

export function getDb() {
  if (_db) return _db

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  // Try opening DB with retries (exponential backoff). This helps Vitest workers avoid
  // transient file-lock / race conditions on CI and Windows filesystems.
  const maxAttempts = 5
  let attempt = 0
  let lastErr = null
  while (attempt < maxAttempts) {
    try {
      // Ensure directory exists and file touched before opening
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
      try {
        const fd = fs.openSync(DB_PATH, 'a', 0o600)
        fs.closeSync(fd)
        try { fs.chmodSync(DB_PATH, 0o600) } catch {}
      } catch (touchErr) {
        // ignore touch errors but log
        console.warn(`[db] could not touch DB file ${DB_PATH}: ${touchErr.message}`)
      }
      try {
        _db = new Database(DB_PATH)
      } catch (dbErr) {
        // rethrow to be handled by outer retry loop
        throw dbErr
      }
      lastErr = null
      break
    } catch (err) {
      lastErr = err
      attempt += 1
      const waitMs = 50 * Math.pow(2, attempt) // 100ms,200,400,800...
      console.warn(`[db] attempt ${attempt}/${maxAttempts} to open DB at ${DB_PATH} failed: ${err.message}; retrying in ${waitMs}ms`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
    }
  }
  if (!_db) {
    // Give helpful diagnostics for CI and local debugging
    const stat = (() => { try { return fs.statSync(DATA_DIR) } catch { return null } })()
    const statMsg = stat ? `dir=${DATA_DIR} mode=${(stat.mode || 0).toString(8)}` : `dir_missing=${DATA_DIR}`
    throw new Error(`Failed to open SQLite DB at ${DB_PATH} after ${maxAttempts} attempts; ${statMsg}; lastError=${lastErr?.message || 'unknown'}`)
  }

  _db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

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

    -- Ensure role column exists for RBAC
    -- (role column handled by migrations further down)

    CREATE TABLE IF NOT EXISTS device_labels (
      mac        TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS network_outages (
      start       INTEGER PRIMARY KEY,
      end         INTEGER,
      duration_ms INTEGER NOT NULL,
      uptime_before_ms INTEGER,
      outage_type TEXT,
      ongoing     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
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

    // Ensure network_outages table exists (idempotent)
    try {
      _db.exec(`
        CREATE TABLE IF NOT EXISTS network_outages (
          start       INTEGER PRIMARY KEY,
          end         INTEGER,
          duration_ms INTEGER NOT NULL,
          uptime_before_ms INTEGER,
          outage_type TEXT,
          ongoing     INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL
        );
      `)
    } catch { /* ignore */ }

  // ── Flags catalogue + device-flag junction table ────────────────────────────
  _db.exec(`
    CREATE TABLE IF NOT EXISTS flags (
      key        TEXT PRIMARY KEY,
      label      TEXT    NOT NULL,
      emoji      TEXT,
      description TEXT,
      type       TEXT    NOT NULL DEFAULT 'custom',
      is_system  INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO flags (key, label, emoji, type, is_system, sort_order) VALUES
      ('favorite', 'Favorite', '★',  'system', 1, 20),
      ('pest',     'Pest',     '🐞', 'system', 1, 10),
      ('icmp_blocked', 'ICMP Blocked', '🚫', 'system', 1, 15),
      ('dodgy',    'Dodgy',    '⚠️', 'system', 1, 12),
      ('dormant',  'Dormant',  '🌙', 'system', 1, 30);

    CREATE TABLE IF NOT EXISTS device_flags (
      mac      TEXT    NOT NULL,
      flag_key TEXT    NOT NULL REFERENCES flags(key) ON DELETE CASCADE,
      set_at   INTEGER NOT NULL,
      PRIMARY KEY (mac, flag_key)
    );
    CREATE INDEX IF NOT EXISTS idx_device_flags_mac  ON device_flags (mac);
    CREATE INDEX IF NOT EXISTS idx_device_flags_flag ON device_flags (flag_key);
  `)

  // Column migrations for flags table (existing installs without type/is_system)
  const flagsCols = _db.all('PRAGMA table_info(flags)').map(c => c.name)
  if (!flagsCols.includes('type')) {
    _db.exec(`ALTER TABLE flags ADD COLUMN type TEXT NOT NULL DEFAULT 'custom'`)
    _db.exec(`UPDATE flags SET type = 'system' WHERE key IN ('favorite','pest','icmp_blocked','dodgy','dormant')`)
    console.log('[db] Added type column to flags.')
  }
  if (!flagsCols.includes('is_system')) {
    _db.exec(`ALTER TABLE flags ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0`)
    _db.exec(`UPDATE flags SET is_system = 1 WHERE key IN ('favorite','pest','icmp_blocked','dodgy','dormant')`)
    console.log('[db] Added is_system column to flags.')
  }

  // One-time migration: correct pest/favorite sort_order so pest ranks first
  const soMigrated = _db.get("SELECT id FROM schema_migrations WHERE id = 'swap_pest_favorite_sort_order'")
  if (!soMigrated) {
    _db.exec(`UPDATE flags SET sort_order = 10 WHERE key = 'pest' AND sort_order < 15`)
    _db.exec(`UPDATE flags SET sort_order = 20 WHERE key = 'favorite' AND sort_order <= 10`)
    const now2 = Date.now()
    _db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", ['swap_pest_favorite_sort_order', now2])
    console.log('[db] Updated pest/favorite sort_order.')
  }

  // One-time migration: copy boolean flag columns → device_flags
  const dfMigrated = _db.get("SELECT id FROM schema_migrations WHERE id = 'boolean_flags_to_device_flags'")
  if (!dfMigrated) {
    const now = Date.now()
    _db.exec(`
      INSERT OR IGNORE INTO device_flags (mac, flag_key, set_at)
        SELECT mac, 'favorite', ${now} FROM devices WHERE favorited = 1;
      INSERT OR IGNORE INTO device_flags (mac, flag_key, set_at)
        SELECT mac, 'pest', ${now} FROM devices WHERE flagged = 1;
      INSERT OR IGNORE INTO device_flags (mac, flag_key, set_at)
        SELECT mac, 'dormant', ${now} FROM devices WHERE dormant = 1;
    `)
    _db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", ['boolean_flags_to_device_flags', now])
    const migrated = _db.get("SELECT COUNT(*) as c FROM device_flags").c
    if (migrated > 0) console.log(`[db] Migrated ${migrated} device flag(s) to device_flags table.`)
  }

  // Ensure users table has a role column and backfill defaults
  try {
    const userCols = _db.all('PRAGMA table_info(users)').map(c => c.name)
    if (!userCols.includes('role')) {
      console.log('[db] Adding role column to users table')
      _db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
      _db.exec("UPDATE users SET role = 'user' WHERE role IS NULL")
    }
    // Ensure at least one admin exists; if none, promote the first user found
    const adminCount = _db.get("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").c || 0
    if (adminCount === 0) {
      const first = _db.get('SELECT username FROM users ORDER BY created_at LIMIT 1')
      if (first && first.username) {
        console.log('[db] No admin found — promoting first user to admin:', first.username)
        _db.exec("UPDATE users SET role = 'admin' WHERE username = '" + first.username.replace(/'/g, "''") + "'")
      }
    }
  } catch (e) {
    console.log('[db] Failed to ensure users.role column:', e.message)
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
      server_id        TEXT,
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
      via              TEXT NOT NULL DEFAULT 'direct',
      provider         TEXT NOT NULL DEFAULT 'cloudflare'
    );
    CREATE INDEX IF NOT EXISTS idx_speedtest_ts ON speedtest_results (ts DESC);
  `)

  // Add via column to speedtest_results for direct/vpn tracking (migration for existing installs)
  const stCols = _db.all("PRAGMA table_info(speedtest_results)").map(c => c.name)
  if (!stCols.includes('via')) {
    _db.exec("ALTER TABLE speedtest_results ADD COLUMN via TEXT NOT NULL DEFAULT 'direct'")
    console.log('[db] Added via column to speedtest_results.')
  }
  if (!stCols.includes('provider')) {
    _db.exec("ALTER TABLE speedtest_results ADD COLUMN provider TEXT NOT NULL DEFAULT 'cloudflare'")
    console.log('[db] Added provider column to speedtest_results.')
  }
  if (!stCols.includes('server_id')) {
    _db.exec("ALTER TABLE speedtest_results ADD COLUMN server_id TEXT")
    console.log('[db] Added server_id column to speedtest_results.')
  }

  // Outage diagnostics table has been archived/removed in recent versions.
  // Historical data is preserved via migration scripts that rename the table to outage_diagnostics_archived.

  // IP history for detectors and auditing
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ip_history (
      ip   TEXT,
      mac  TEXT,
      ts   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ip_hist_ip  ON ip_history (ip);
    CREATE INDEX IF NOT EXISTS idx_ip_hist_mac ON ip_history (mac);
  `)

  // Alerts table: aggregated detector findings
  _db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,
      key        TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '{}',
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      UNIQUE(type, key)
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_lastseen ON alerts (last_seen DESC);
  `)

  // Pi devices table (management of Raspberry Pis for deployments)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS pis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      host TEXT,
      ssh_user TEXT,
      retention_days INTEGER DEFAULT 7,
      external_paths TEXT DEFAULT '[]'
    );
  `)
  

  // VPN exit-node metadata — single row, upserted whenever VPN info is detected
  _db.exec(`
    CREATE TABLE IF NOT EXISTS vpn_state (
      id             INTEGER PRIMARY KEY DEFAULT 1,
      iface          TEXT,
      client_ip      TEXT,
      client_isp     TEXT,
      client_city    TEXT,
      client_country TEXT,
      client_lat     REAL,
      client_lon     REAL,
      updated_at     INTEGER NOT NULL
    );
  `)

  // mtr snapshots — scheduled baselines and outage-repeat traces
  _db.exec(`
    CREATE TABLE IF NOT EXISTS mtr_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'baseline',
      outage_ts  INTEGER,
      output     TEXT,
      captured_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mtr_ts ON mtr_snapshots (ts DESC);
  `)

  // Additional indexes to support report queries and faster lookups
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mtr_type        ON mtr_snapshots (type);
    -- idx_outage_captured removed; archived diagnostics use outage_diagnostics_archived if present
    CREATE INDEX IF NOT EXISTS idx_speedtest_provider ON speedtest_results (provider);
    CREATE INDEX IF NOT EXISTS idx_speedtest_via      ON speedtest_results (via);
    CREATE INDEX IF NOT EXISTS idx_alerts_type        ON alerts (type);
  `)

  // Historical outage diagnostics tables (current + archived)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS outage_diagnostics (
      outage_ts INTEGER PRIMARY KEY,
      traceroute TEXT,
      ping_detail TEXT,
      gateway TEXT,
      outage_type TEXT,
      captured_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS outage_diagnostics_archived (
      outage_ts INTEGER PRIMARY KEY,
      traceroute TEXT,
      ping_detail TEXT,
      gateway TEXT,
      outage_type TEXT,
      captured_at INTEGER
    );
    -- Network uptime/downtime persistence
    CREATE TABLE IF NOT EXISTS network_check_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      iface TEXT,
      total_targets INTEGER NOT NULL DEFAULT 0,
      total_outages INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS network_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      target TEXT NOT NULL,
      direct_ok INTEGER NOT NULL DEFAULT 0,
      tun_ok INTEGER NOT NULL DEFAULT 0,
      outage INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(run_id) REFERENCES network_check_runs(id)
    );
  `)

    // Backfill / migration: ensure legacy databases have the new columns with defaults.
    try {
      const cols = _db.prepare("PRAGMA table_info('network_check_runs')").all().map(r => r.name)
      if (!cols.includes('total_targets')) {
        _db.exec("ALTER TABLE network_check_runs ADD COLUMN total_targets INTEGER NOT NULL DEFAULT 0;")
      }
      if (!cols.includes('total_outages')) {
        _db.exec("ALTER TABLE network_check_runs ADD COLUMN total_outages INTEGER NOT NULL DEFAULT 0;")
      }
    } catch (e) {
      // best-effort migration; log and continue
      console.warn('[db] network_check_runs migration warning:', e && e.message)
    }

  console.log(`[db] SQLite ready at ${DB_PATH}`)
  return _db
}

// Helper: run DB statements with retry on busy/locked errors
function runWithRetry(db, fn, maxAttempts = 6) {
  let attempt = 0
  while (true) {
    try {
      return fn()
    } catch (err) {
      attempt += 1
      const msg = (err && err.message) || ''
      if (attempt >= maxAttempts || !/locked|busy/i.test(msg)) throw err
      const waitMs = 50 * Math.pow(2, attempt) // 100,200,400...
      console.warn(`[db] transient DB lock detected, retry ${attempt}/${maxAttempts} after ${waitMs}ms: ${msg}`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
    }
  }
}

// Simple in-memory serialized writer queue to ensure single-writer semantics
const writeQueue = []
let writeRunning = false
function enqueueWrite(task) {
  return new Promise((resolve, reject) => {
    writeQueue.push({ task, resolve, reject })
    if (!writeRunning) processQueue()
  })
}
function processQueue() {
  if (writeRunning) return
  const next = writeQueue.shift()
  if (!next) return
  writeRunning = true
  Promise.resolve().then(() => {
    try {
      const res = runWithRetry(getDb(), next.task)
      next.resolve(res)
    } catch (e) { next.reject(e) }
  }).finally(() => { writeRunning = false; setImmediate(processQueue) })
}

// Persist computed outages into network_outages table.
// Scans audit_log for internet.down/internet.up and upserts incidents.
export function persistOutages() {
  const db = getDb()
  try {
    let events = db.all(`SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts ASC`)
    if (events && events.length > 0 && events[0].ts && events[0].ts < 1e12) {
      events = events.map(e => ({ ...e, ts: Number(e.ts) * 1000 }))
    }
    const outages = []
    let downTs = null, downType = null, _lastUpTs = null
    let _lastPayload = null
    if (!events || events.length === 0) {
      const checks = db.all(`SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts ASC`)
      for (const c of checks) {
        let p = null
        try { p = JSON.parse(c.payload) } catch { p = null }
        const ok = p ? Boolean(p.ok) : false
        if (!ok && downTs === null) { downTs = c.ts; downType = p?.outage_type ?? null }
        else if (ok && downTs !== null) { outages.push({ start: downTs, end: c.ts, durationMs: c.ts - downTs, outage_type: downType, ongoing: false }); _lastUpTs = c.ts; downTs = null; downType = null }
        else if (ok) { _lastUpTs = c.ts }
      }
    } else {
      for (const e of events) {
        if (e.event === 'internet.down' && downTs === null) {
          downTs = e.ts
          try { const p = JSON.parse(e.payload); downType = p.outage_type ?? null; _lastPayload = p } catch { downType = null; _lastPayload = null }
        }
        else if (e.event === 'internet.up' && downTs !== null) {
          outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, outage_type: downType, ongoing: false, payload: _lastPayload })
          _lastUpTs = e.ts; downTs = null; downType = null; _lastPayload = null
        }
        else if (e.event === 'internet.up') { _lastUpTs = e.ts }
      }
    }
    if (downTs !== null) { outages.push({ start: downTs, end: null, durationMs: Date.now() - downTs, outage_type: downType, ongoing: true }) }

    // Upsert into network_outages — prefer payload.detected_at when present so
    // stored start/duration reflect detection -> discovery rather than pairing timestamps.
    // Use a safer upsert that only replaces an existing row when the newly computed
    // duration is greater than the stored one. This prevents accidental shrinking
    // of previously-observed outages (e.g. due to late-arriving diagnostic timestamps).
    const now = Date.now()
    const upsertSql = `INSERT INTO network_outages (start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at)
                       VALUES ($start,$end,$duration_ms,$uptime_before_ms,$outage_type,$ongoing,$created_at)
                       ON CONFLICT(start) DO UPDATE SET
                         end = excluded.end,
                         duration_ms = excluded.duration_ms,
                         uptime_before_ms = excluded.uptime_before_ms,
                         outage_type = excluded.outage_type,
                         ongoing = excluded.ongoing,
                         created_at = excluded.created_at
                       WHERE excluded.duration_ms > network_outages.duration_ms`
    const upsert = db.prepare(upsertSql)

    for (const o of outages) {
      // Normalize start/end to numbers (ms). Coerce missing start to now (defensive).
      let start = Number(o.start)
      if (!isFinite(start) || start <= 0) start = Date.now()
      let end = o.end == null ? null : Number(o.end)
      if (end != null && (!isFinite(end) || end <= 0)) end = null

      // If payload provided a detected_at timestamp, and it looks sane, prefer that as the start
      if (o.payload && o.payload.detected_at) {
        let det = Number(o.payload.detected_at)
        if (isFinite(det) && det > 0) {
          if (det < 1e12) det = det * 1000 // seconds -> ms
          // Only accept detected_at if it's not in the future and not unreasonably far from the paired start
          const nowLocal = Date.now()
          if (det <= nowLocal && Math.abs(det - start) < 1000 * 60 * 60 * 24) {
            start = Math.round(det)
          }
        }
      }

      // Compute duration from start->end (or start->now for ongoing). Ensure non-negative integer.
      let duration = 0
      if (end != null) duration = Math.round(Math.max(0, end - start))
      else duration = Math.round(Math.max(0, Date.now() - start))

      // Compute uptime_before_ms where possible (time between previous up and this down).
      // The calling code that constructs `outages` may include uptimeBeforeMs; prefer that when present.
      let uptime_before_ms = null
      if (o.uptimeBeforeMs != null) uptime_before_ms = Number(o.uptimeBeforeMs)
      else if (o.uptime_before_ms != null) uptime_before_ms = Number(o.uptime_before_ms)
      if (uptime_before_ms != null && (!isFinite(uptime_before_ms) || uptime_before_ms < 0)) uptime_before_ms = null

      const type = o.outage_type ?? null
      const ongoing = o.ongoing ? 1 : 0
      try {
        upsert.run({ $start: start, $end: end, $duration_ms: duration, $uptime_before_ms: uptime_before_ms, $outage_type: type, $ongoing: ongoing, $created_at: now })
      } catch (e) {
        console.error('[db] persistOutages: upsert failed for outage object:', JSON.stringify(o), e && e.message)
        try { console.error('[db] persistOutages: bound params ->', JSON.stringify({ start, end, duration, type, ongoing })) } catch {}
        throw e
      }
    }
    return outages.length
  } catch (err) {
    console.error('[db] persistOutages failed:', err.message)
    return 0
  }
}

/**
 * Create materialized summary table for internet checks and provide a backfill helper.
 * Columns: day (YYYY-MM-DD), checks, ok_count, avg_ms, min_ms, max_ms
 */
export function ensureInternetSummary() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS internet_summary (
      day TEXT PRIMARY KEY,
      checks INTEGER NOT NULL DEFAULT 0,
      ok_count INTEGER NOT NULL DEFAULT 0,
      avg_ms REAL,
      min_ms INTEGER,
      max_ms INTEGER,
      ts INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_internet_summary_day ON internet_summary (day);
  `)
}

export function backfillInternetSummary(fromTs = 0, toTs = Date.now()) {
  const db = getDb()
  ensureInternetSummary()
  // Aggregate from mtr_snapshots/ speedtest or archived outage diagnostics when present.
  let rows = []
  try {
    rows = db.all('SELECT outage_ts, ping_detail, captured_at FROM outage_diagnostics WHERE captured_at BETWEEN ? AND ?', [fromTs, toTs])
  } catch {
    try {
      rows = db.all('SELECT outage_ts, ping_detail, captured_at FROM outage_diagnostics_archived WHERE captured_at BETWEEN ? AND ?', [fromTs, toTs])
    } catch { rows = [] }
  }
  const byDay = new Map()
  for (const r of rows) {
    const day = new Date(r.captured_at).toISOString().slice(0,10)
    try {
      const ping = JSON.parse(r.ping_detail || '[]')
      const msVals = ping.map(p => p.ms ?? null).filter(x => x != null)
      const okCount = ping.filter(p => p.ok).length
      const checks = ping.length
      const avg = msVals.length ? (msVals.reduce((s,v)=>s+v,0)/msVals.length) : null
      const min = msVals.length ? Math.min(...msVals) : null
      const max = msVals.length ? Math.max(...msVals) : null
      const existing = byDay.get(day) ?? { checks:0, ok_count:0, sum:0, cnt:0, min:null, max:null }
      existing.checks += checks
      existing.ok_count += okCount
      if (avg != null) { existing.sum += avg * checks; existing.cnt += checks }
      existing.min = existing.min === null ? min : (min !== null ? Math.min(existing.min, min) : existing.min)
      existing.max = existing.max === null ? max : (max !== null ? Math.max(existing.max, max) : existing.max)
      byDay.set(day, existing)
    } catch { /* ignore parse errors */ }
  }
  const now = Date.now()
  for (const [day, v] of byDay.entries()) {
    const avgMs = v.cnt ? (v.sum / v.cnt) : null
    db.run(`INSERT INTO internet_summary (day, checks, ok_count, avg_ms, min_ms, max_ms, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(day) DO UPDATE SET
              checks = checks + excluded.checks,
              ok_count = ok_count + excluded.ok_count,
              avg_ms = COALESCE(excluded.avg_ms, avg_ms),
              min_ms = COALESCE(excluded.min_ms, min_ms),
              max_ms = COALESCE(excluded.max_ms, max_ms),
              updated_at = ?`, [day, v.checks, v.ok_count, avgMs, v.min, v.max, now, now])
  }
  return Array.from(byDay.keys()).length
}

// Create daily events summary table and backfill helper
export function ensureDailyEventSummary() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_event_summary (
      day TEXT PRIMARY KEY,
      new_devices INTEGER NOT NULL DEFAULT 0,
      online_events INTEGER NOT NULL DEFAULT 0,
      offline_events INTEGER NOT NULL DEFAULT 0,
      port_finds INTEGER NOT NULL DEFAULT 0,
      ts INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_event_day ON daily_event_summary (day);
  `)
}

export function backfillDailyEventSummary(fromTs = 0, toTs = Date.now()) {
  const db = getDb()
  ensureDailyEventSummary()
  // Aggregate device_events by day
  const rows = db.all('SELECT ts, event FROM device_events WHERE ts BETWEEN ? AND ?', [fromTs, toTs])
  const byDay = new Map()
  for (const r of rows) {
    const day = new Date(r.ts).toISOString().slice(0,10)
    const rec = byDay.get(day) ?? { new_devices:0, online:0, offline:0, ports:0 }
    if (r.event === 'device.new') rec.new_devices++
    else if (r.event === 'device.online') rec.online++
    else if (r.event === 'device.offline') rec.offline++
    else if (r.event === 'device.port.open') rec.ports++
    byDay.set(day, rec)
  }
  const now = Date.now()
  for (const [day, v] of byDay.entries()) {
    db.run(`INSERT INTO daily_event_summary (day, new_devices, online_events, offline_events, port_finds, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(day) DO UPDATE SET
              new_devices = new_devices + excluded.new_devices,
              online_events = online_events + excluded.online_events,
              offline_events = offline_events + excluded.offline_events,
              port_finds = port_finds + excluded.port_finds,
              updated_at = ?`, [day, v.new_devices, v.online, v.offline, v.ports, now, now])
  }
  return Array.from(byDay.keys()).length
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
    const db = getDb()
    return enqueueWrite(() => runWithRetry(db, () => db.run('INSERT INTO audit_log (ts, event, actor, payload, ip) VALUES (?, ?, ?, ?, ?)', [Date.now(), event, actor, JSON.stringify(payload), ip])))
  } catch (err) {
    console.error('[audit] write failed:', err && err.message)
  }
}

/** Record a device lifecycle event (online/offline/new/port change). */
export function auditDevice(event, mac, ip, hostname, payload = {}) {
  try {
    const db = getDb()
    return enqueueWrite(() => runWithRetry(db, () => db.run('INSERT INTO device_events (ts, event, mac, ip, hostname, payload) VALUES (?, ?, ?, ?, ?, ?)', [Date.now(), event, mac ?? null, ip ?? null, hostname ?? null, JSON.stringify(payload)])))
  } catch (err) {
    console.error('[auditDevice] write failed:', err && err.message)
  }
}

/** Return the persisted VPN exit-node metadata, or null if never recorded. */
export function getVpnState() {
  try { return getDb().get('SELECT * FROM vpn_state WHERE id = 1') ?? null } catch { return null }
}

/** Persist VPN exit-node metadata (upsert, single row). */
export function setVpnState(data) {
  try {
    const db = getDb()
    return enqueueWrite(() => runWithRetry(db, () => db.run(`INSERT OR REPLACE INTO vpn_state
         (id, iface, client_ip, client_isp, client_city, client_country, client_lat, client_lon, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`, [data.iface ?? null, data.client_ip ?? null, data.client_isp ?? null,
       data.client_city ?? null, data.client_country ?? null,
       data.client_lat ?? null, data.client_lon ?? null, Date.now()])))
  } catch (err) {
    console.error('[vpn_state] write failed:', err && err.message)
  }
}

/** Delete audit_log and device_events entries older than retentionDays. */
export function pruneOldData(retentionDays) {
  // If a retention_until setting exists, use that instead of retentionDays
  const db = getDb()
  const row = db.prepare(`SELECT v FROM retention_settings WHERE k = 'retention_until'`).get()
  let cutoff
  if (row && row.v) {
    const until = new Date(row.v).getTime()
    cutoff = until
  } else {
    cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  }
  db.run('DELETE FROM audit_log    WHERE ts < ?', [cutoff])
  db.run('DELETE FROM device_events WHERE ts < ?', [cutoff])
  // Keep mtr_snapshots on the same retention window (they can be large)
  db.run('DELETE FROM mtr_snapshots WHERE ts < ?', [cutoff])
  // Prune evidence files older than cutoff
  try {
    const evRows = db.all('SELECT id, path FROM evidence_files WHERE uploaded_at < ?', [cutoff])
    for (const r of evRows) {
      try { if (r.path && fs.existsSync(r.path)) fs.unlinkSync(r.path) } catch {}
      db.run('DELETE FROM evidence_files WHERE id = ?', [r.id])
    }
  } catch (_e) { console.error('[prune] evidence prune failed', _e.message) }
}

export function upsertDevice(device) {
  const now = Date.now()
  const db = getDb()
  const pk = device.mac ?? `noMAC:${device.ip}`
  const overwritePorts = device.overwritePorts === true ? 1 : 0

  // When a real MAC is discovered for a device previously stored without one, remove the placeholder
  if (device.mac) {
    enqueueWrite(() => runWithRetry(db, () => db.run("DELETE FROM devices WHERE mac = ?", [`noMAC:${device.ip}`])))
  }

  // If another device previously held this IP (DHCP reassignment), evict it first
  enqueueWrite(() => runWithRetry(db, () => db.run("DELETE FROM devices WHERE ip = ? AND mac != ?", [device.ip, pk])))

  const isActive = device.status === 'online' || device.status === 'filtered'
  const effectiveStatus = device.status === 'online' ? 'online' : device.status === 'filtered' ? 'filtered' : 'offline'

  enqueueWrite(() => runWithRetry(db, () => db.run(`
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
      ports        = CASE WHEN ? = 1 THEN excluded.ports ELSE CASE WHEN json_array_length(excluded.ports) > 0 THEN excluded.ports ELSE devices.ports END END,
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
    overwritePorts,
  ])))
}

export function clearAllDevices() {
  const db = getDb()
  enqueueWrite(() => runWithRetry(db, () => db.run('DELETE FROM devices')))
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
  const db = getDb()
  enqueueWrite(() => runWithRetry(db, () => db.run(
    "UPDATE devices SET ports = '[]', host_scripts = '[]', traceroute = '[]' WHERE mac = ?",
    [mac]
  )))
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
  const db = getDb()
  if (status === 'online') {
    enqueueWrite(() => runWithRetry(db, () => db.run('UPDATE devices SET status = ?, latency = ?, last_seen = ? WHERE mac = ?', [status, latency ?? null, now, mac])))
  } else {
    enqueueWrite(() => runWithRetry(db, () => db.run("UPDATE devices SET status = 'offline' WHERE mac = ?", [mac])))
  }
}

export function getAllFlags() {
  return getDb().all('SELECT key, label, emoji, description, type, is_system, sort_order FROM flags ORDER BY sort_order, key')
    .map(r => ({ key: r.key, label: r.label, icon: r.emoji ?? null, description: r.description, type: r.type, sort_order: r.sort_order, isSystem: r.is_system === 1 }))
}

export function createFlag({ key, label, icon = null, description = null, sortOrder = 100 }) {
  if (!key || !/^[a-z0-9_-]{1,32}$/.test(key)) throw new Error('Invalid flag key')
  getDb().run(
    `INSERT INTO flags (key, label, emoji, description, type, is_system, sort_order)
     VALUES (?, ?, ?, ?, 'custom', 0, ?)`,
    [key, label, icon, description, sortOrder]
  )
  const r = getDb().get('SELECT * FROM flags WHERE key = ?', [key])
  return { key: r.key, label: r.label, icon: r.emoji ?? null, description: r.description, type: r.type, sort_order: r.sort_order, isSystem: r.is_system === 1 }
}

export function updateFlag(key, { label, icon, description, sortOrder }) {
  const flag = getDb().get('SELECT is_system FROM flags WHERE key = ?', [key])
  if (!flag) throw new Error('Flag not found')
  if (flag.is_system) throw new Error('System flags cannot be modified')
  const sets = []
  const vals = []
  if (label       !== undefined) { sets.push('label = ?');       vals.push(label) }
  if (icon        !== undefined) { sets.push('emoji = ?');        vals.push(icon) }
  if (description !== undefined) { sets.push('description = ?'); vals.push(description) }
  if (sortOrder   !== undefined) { sets.push('sort_order = ?');  vals.push(sortOrder) }
  if (sets.length === 0) throw new Error('Nothing to update')
  vals.push(key)
  getDb().run(`UPDATE flags SET ${sets.join(', ')} WHERE key = ?`, vals)
  const r = getDb().get('SELECT * FROM flags WHERE key = ?', [key])
  return { key: r.key, label: r.label, icon: r.emoji ?? null, description: r.description, type: r.type, sort_order: r.sort_order, isSystem: r.is_system === 1 }
}

export function deleteFlag(key) {
  const flag = getDb().get('SELECT is_system FROM flags WHERE key = ?', [key])
  if (!flag) throw new Error('Flag not found')
  if (flag.is_system) throw new Error('System flags cannot be deleted')
  // device_flags rows cascade-delete via FK
  getDb().run('DELETE FROM flags WHERE key = ?', [key])
}

export function getAllDevices() {
  return getDb().all(`
    SELECT d.*, dl.label,
           GROUP_CONCAT(df.flag_key) AS flag_keys
    FROM devices d
    LEFT JOIN device_labels dl ON dl.mac = d.mac
    LEFT JOIN device_flags  df ON df.mac = d.mac
    GROUP BY d.mac
    ORDER BY d.ip
  `).map(r => {
    const flags = r.flag_keys ? r.flag_keys.split(',') : []
    return {
      ip: r.ip,
      mac: r.mac?.startsWith('noMAC:') ? null : r.mac,
      vendor: r.vendor, hostname: r.hostname, hostnameStale: r.hostname_stale === 1,
      label: r.label ?? null,
      status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen,
      lastOnline: r.last_online ?? null,
      updatedAt: r.updated_at ?? null,
      flags,
      favorited: flags.includes('favorite'),
      flagged:   flags.includes('pest'),
      dodgy:     flags.includes('dodgy'),
      dormant:   flags.includes('dormant'),
      latency: r.latency, os: r.os,
      ports: JSON.parse(r.ports || '[]'),
      hostScripts: JSON.parse(r.host_scripts || '[]'),
      traceroute: JSON.parse(r.traceroute || '[]'),
    }
  })
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

export function toggleDeviceFlag(mac, flagKey) {
  const db = getDb()
  const exists = db.get('SELECT 1 FROM device_flags WHERE mac = ? AND flag_key = ?', [mac, flagKey])
  if (exists) {
    db.run('DELETE FROM device_flags WHERE mac = ? AND flag_key = ?', [mac, flagKey])
    return false
  } else {
    db.run('INSERT INTO device_flags (mac, flag_key, set_at) VALUES (?, ?, ?)', [mac, flagKey, Date.now()])
    return true
  }
}

export function toggleFavorite(mac) { return toggleDeviceFlag(mac, 'favorite') }
export function toggleFlagged(mac)  { return toggleDeviceFlag(mac, 'pest') }
export function toggleDormant(mac)  { return toggleDeviceFlag(mac, 'dormant') }

export function setDeviceFlag(mac, flagKey, enabled) {
  const db = getDb()
  if (enabled) {
    db.run('INSERT OR IGNORE INTO device_flags (mac, flag_key, set_at) VALUES (?, ?, ?)', [mac, flagKey, Date.now()])
    return true
  }
  db.run('DELETE FROM device_flags WHERE mac = ? AND flag_key = ?', [mac, flagKey])
  return false
}

/**
 * Auto-dormant devices that have been offline for >= `days` days.
 * Only transitions dormant=0 → 1; never clears manually-set dormant.
 * Returns the number of devices newly marked dormant.
 */
export function autoDormantStale(days = 3) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const now = Date.now()
  const result = getDb().run(
    `INSERT OR IGNORE INTO device_flags (mac, flag_key, set_at)
     SELECT mac, 'dormant', ?
     FROM devices
     WHERE mac NOT IN (SELECT mac FROM device_flags WHERE flag_key = 'dormant')
       AND status = 'offline'
       AND (last_online IS NOT NULL AND last_online < ? OR last_online IS NULL AND first_seen < ?)`,
    [now, cutoff, cutoff]
  )
  return result.changes ?? 0
}
