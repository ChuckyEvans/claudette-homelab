/**
 * Seed a self-contained demo dataset for screenshot / demo purposes.
 *
 * Usage:
 *   node scripts/seed-demo-db.mjs [--out-dir <path>]
 *   Default output dir: data-demo/
 *
 * Produces:
 *   <outDir>/config.yaml
 *   <outDir>/claudette.db        (devices, speedtests, audit log, outages, VPN, DDNS…)
 *   <outDir>/ddns-status.json
 *   <outDir>/ddns-history.json
 *   <outDir>/state.json
 *
 * The Docker run line for local screenshots:
 *   docker run -d --name claudette-demo --rm -p 7654:7654 \
 *     -v "$(pwd)/data-demo:/app/data" \
 *     claudette:latest
 */

import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')

const outArg = process.argv.indexOf('--out-dir')
const OUT_DIR = outArg !== -1 ? path.resolve(process.argv[outArg + 1]) : path.join(ROOT, 'data-demo')

fs.mkdirSync(OUT_DIR, { recursive: true })
console.log(`Seeding demo dataset → ${OUT_DIR}`)

// ── Helpers ───────────────────────────────────────────────────────────────────
const now   = Date.now()
const DAY   = 86_400_000
const HOUR  = 3_600_000
const MIN   = 60_000

function ts(offsetMs = 0) { return now + offsetMs }
function ago(ms)           { return now - ms }

// bcrypt hash for password "demo" (cost 10)
const DEMO_PASSWORD_HASH = '$2b$10$cpdXD6qHJ1XQ0hKWzd2IWO7nNDFAkQtVZjDHES8pqgsSqsCtDqdOm'

// ── config.yaml ───────────────────────────────────────────────────────────────
const CONFIG_YAML = `\
config_version: 0.2.0
pi:
  host: 192.168.1.1
  ssh_user: ubuntu
services:
  - name: Home Assistant
    type: http
    url: http://192.168.1.50:8123
    expect_status: 200
  - name: Plex
    type: http
    url: http://192.168.1.50:32400/web
    expect_status: 200
  - name: Pi-hole
    type: http
    url: http://192.168.1.1/admin
    expect_status: 200
  - name: Nginx Proxy Manager
    type: http
    url: http://192.168.1.50:81
    expect_status: 200
  - name: Portainer
    type: docker
    container: portainer
  - name: Transmission
    type: docker
    container: transmission
alerts:
  email:
    enabled: false
  slack:
    enabled: false
threats:
  keywords:
    - docker
    - nginx
    - python flask
    - home assistant
    - plex
    - raspberry pi
  severity_threshold: high
schedule:
  check_interval_minutes: 5
  internet_check_minutes: 5
  threat_interval_hours: 6
  ping_interval_minutes: 5
  deep_scan_hour: 4
  speedtest_interval_hours: 4
  vpn_speedtest_interval_hours: 4
  backup_interval_days: 0
  backup_keep_days: 7
  internet_outage_check_seconds: 5
  mtr_baseline_hours: 1
  mtr_outage_repeat_minutes: 15
  speedtest_provider: ookla
network:
  connectivity_hosts:
    - 1.1.1.1
    - 8.8.8.8
  subnets:
    - 192.168.1.0/24
  fallback_dns: []
  dormant_after_days: 3
  skull_after_days: 7
  vpn_interface: tun0
ui:
  theme: dark
isp:
  name: Apex Fibre
  connection_type: fibre
  expected_uptime: 99.9
  plan_download_mbps: 500
  plan_upload_mbps: 500
  account_number: ''
  support_email: ''
  sla_url: ''
  sla_notes: ''
infra:
  name: Metro Fibre
  connection_type: fibre
  sla_pct: 99.5
  plan_download_mbps: 500
  plan_upload_mbps: 500
  account_number: ''
  support_email: ''
  sla_url: ''
  sla_notes: ''
retention:
  days: 365
ddns:
  enabled: true
  provider: duckdns
  check_interval_minutes: 5
  history_retention_days: 365
  noip:
    username: ''
    password: ''
    hostname: ''
  duckdns:
    token: demo-token-placeholder
    domains: my-homelab
  dynu:
    username: ''
    password: ''
    hostname: ''
  dyndns:
    username: ''
    password: ''
    hostname: ''
  afraid:
    update_url: ''
  cloudflare:
    api_token: ''
    zone_id: ''
    record_id: ''
    hostname: ''
`
fs.writeFileSync(path.join(OUT_DIR, 'config.yaml'), CONFIG_YAML)
console.log('  ✓ config.yaml')

// ── SQLite DB ─────────────────────────────────────────────────────────────────
const DB_PATH = path.join(OUT_DIR, 'claudette.db')
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
const db = new Database(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE audit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    event   TEXT    NOT NULL,
    actor   TEXT    NOT NULL DEFAULT 'system',
    payload TEXT    NOT NULL DEFAULT '{}',
    ip      TEXT
  );
  CREATE INDEX idx_audit_ts    ON audit_log (ts DESC);
  CREATE INDEX idx_audit_event ON audit_log (event);

  CREATE TABLE device_labels (
    mac        TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE schema_migrations (
    id         TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );

  CREATE TABLE devices (
    mac            TEXT PRIMARY KEY,
    ip             TEXT NOT NULL,
    vendor         TEXT,
    hostname       TEXT,
    hostname_stale INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'offline',
    first_seen     INTEGER NOT NULL,
    last_seen      INTEGER,
    last_online    INTEGER,
    updated_at     INTEGER,
    latency        INTEGER,
    os             TEXT,
    ports          TEXT NOT NULL DEFAULT '[]',
    host_scripts   TEXT NOT NULL DEFAULT '[]',
    traceroute     TEXT NOT NULL DEFAULT '[]',
    favorited      INTEGER NOT NULL DEFAULT 0,
    flagged        INTEGER NOT NULL DEFAULT 0,
    dormant        INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX idx_devices_ip     ON devices (ip);
  CREATE        INDEX idx_devices_status ON devices (status);

  CREATE TABLE flags (
    key         TEXT PRIMARY KEY,
    label       TEXT    NOT NULL,
    emoji       TEXT,
    description TEXT,
    type        TEXT    NOT NULL DEFAULT 'custom',
    is_system   INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO flags (key, label, emoji, type, is_system, sort_order) VALUES
    ('favorite', 'Favorite', '★',  'system', 1, 20),
    ('pest',     'Pest',     '🐞', 'system', 1, 10),
    ('dormant',  'Dormant',  '🌙', 'system', 1, 30);

  CREATE TABLE device_flags (
    mac      TEXT    NOT NULL,
    flag_key TEXT    NOT NULL REFERENCES flags(key) ON DELETE CASCADE,
    set_at   INTEGER NOT NULL,
    PRIMARY KEY (mac, flag_key)
  );
  CREATE INDEX idx_device_flags_mac  ON device_flags (mac);
  CREATE INDEX idx_device_flags_flag ON device_flags (flag_key);

  CREATE TABLE device_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       INTEGER NOT NULL,
    event    TEXT NOT NULL,
    mac      TEXT,
    ip       TEXT,
    hostname TEXT,
    payload  TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_dev_events_ts  ON device_events (ts DESC);
  CREATE INDEX idx_dev_events_mac ON device_events (mac);
  CREATE INDEX idx_dev_events_evt ON device_events (event);

  CREATE TABLE speedtest_results (
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
    via              TEXT NOT NULL DEFAULT 'direct',
    provider         TEXT NOT NULL DEFAULT 'ookla'
  );
  CREATE INDEX idx_speedtest_ts ON speedtest_results (ts DESC);

  CREATE TABLE outage_diagnostics (
    outage_ts   INTEGER PRIMARY KEY,
    traceroute  TEXT,
    ping_detail TEXT,
    gateway     TEXT,
    outage_type TEXT,
    captured_at INTEGER NOT NULL
  );

  CREATE TABLE vpn_state (
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

  CREATE TABLE mtr_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    type        TEXT    NOT NULL DEFAULT 'baseline',
    outage_ts   INTEGER,
    output      TEXT,
    captured_at INTEGER NOT NULL
  );
  CREATE INDEX idx_mtr_ts ON mtr_snapshots (ts DESC);
`)

// ── Users ─────────────────────────────────────────────────────────────────────
db.run(
  'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
  ['demo', DEMO_PASSWORD_HASH, ago(30 * DAY)]
)

// ── Devices ───────────────────────────────────────────────────────────────────
const DEVICES = [
  // ip,               mac,                vendor,              hostname,              status,   latency, os,                 ports (JSON),                                                                             favorited, flagged
  ['192.168.1.1',  'dc:a6:32:11:00:01', 'Raspberry Pi',      'raspberrypi',         'online',  1,  'Linux 5.x',   '[{"port":22,"proto":"tcp","state":"open","service":"ssh"},{"port":53,"proto":"tcp","state":"open","service":"domain"},{"port":80,"proto":"tcp","state":"open","service":"http"}]',                                                                 1, 0],
  ['192.168.1.50', 'b8:27:eb:22:00:02', 'Raspberry Pi',      'homelab-server',      'online',  2,  'Linux 5.x',   '[{"port":22,"proto":"tcp","state":"open","service":"ssh"},{"port":80,"proto":"tcp","state":"open","service":"http"},{"port":443,"proto":"tcp","state":"open","service":"https"},{"port":8123,"proto":"tcp","state":"open","service":"http-alt"},{"port":32400,"proto":"tcp","state":"open","service":"plex"},{"port":9000,"proto":"tcp","state":"open","service":"portainer"}]', 1, 0],
  ['192.168.1.10', 'a4:c3:f0:33:00:03', 'Apple',             'MacBook-Pro',         'online',  5,  'macOS 14.x',  '[{"port":22,"proto":"tcp","state":"open","service":"ssh"}]',                                          0, 0],
  ['192.168.1.11', '3c:22:fb:44:00:04', 'Samsung',           'Galaxy-S24',          'online',  8,  null,          '[]',                                                                                                0, 0],
  ['192.168.1.12', '58:ef:68:55:00:05', 'Amazon',            'Echo-Dot',            'online',  12, null,          '[{"port":4070,"proto":"tcp","state":"open","service":"alexa"}]',                                     0, 0],
  ['192.168.1.13', '70:85:c2:66:00:06', 'TP-Link',           'tplink-switch',       'online',  1,  null,          '[{"port":80,"proto":"tcp","state":"open","service":"http"}]',                                        0, 0],
  ['192.168.1.14', 'e4:5f:01:77:00:07', 'Intel',             'Desktop-PC',          'online',  3,  'Windows 11',  '[{"port":3389,"proto":"tcp","state":"open","service":"rdp"}]',                                       0, 0],
  ['192.168.1.15', '00:11:32:88:00:08', 'Synology',          'NAS',                 'online',  4,  'DSM 7.x',     '[{"port":5000,"proto":"tcp","state":"open","service":"http"},{"port":5001,"proto":"tcp","state":"open","service":"https"},{"port":445,"proto":"tcp","state":"open","service":"smb"}]', 1, 0],
  ['192.168.1.16', 'f0:9f:c2:99:00:09', 'Ubiquiti',          'UniFi-AP',            'online',  2,  null,          '[{"port":22,"proto":"tcp","state":"open","service":"ssh"},{"port":443,"proto":"tcp","state":"open","service":"https"}]', 0, 0],
  ['192.168.1.17', '2c:cf:67:aa:00:10', 'Nintendo',          'Nintendo-Switch',     'online',  15, null,          '[]',                                                                                                0, 0],
  ['192.168.1.18', 'ac:bc:32:bb:00:11', 'Apple',             'iPad',                'online',  7,  null,          '[]',                                                                                                0, 0],
  ['192.168.1.19', '1c:36:bb:cc:00:12', 'Philips',           'Hue-Bridge',          'online',  3,  null,          '[{"port":80,"proto":"tcp","state":"open","service":"http"},{"port":443,"proto":"tcp","state":"open","service":"https"}]', 0, 0],
  ['192.168.1.20', '78:2b:46:dd:00:13', 'Google',            'Chromecast',          'online',  9,  null,          '[{"port":8008,"proto":"tcp","state":"open","service":"http"}]',                                      0, 0],
  ['192.168.1.21', '9c:b6:d0:ee:00:14', 'Netgear',           null,                  'online',  6,  null,          '[{"port":80,"proto":"tcp","state":"open","service":"http"},{"port":23,"proto":"tcp","state":"open","service":"telnet"}]', 0, 1],
  ['192.168.1.22', '20:89:84:ff:00:15', 'Sonos',             'Sonos-Play5',         'online',  5,  null,          '[{"port":1400,"proto":"tcp","state":"open","service":"http"}]',                                      0, 0],
  ['192.168.1.23', 'b4:7c:9c:11:00:16', 'Xiaomi',            null,                  'online',  11, null,          '[]',                                                                                                0, 0],
  ['192.168.1.30', 'dc:ef:ca:22:00:17', 'Raspberry Pi',      'pihole',              'online',  1,  'Linux 5.x',   '[{"port":22,"proto":"tcp","state":"open","service":"ssh"},{"port":53,"proto":"tcp","state":"open","service":"domain"},{"port":80,"proto":"tcp","state":"open","service":"http"}]', 0, 0],
  ['192.168.1.40', '00:50:56:33:00:18', 'VMware',            'ubuntu-vm',           'offline', null, 'Linux 6.x', '[{"port":22,"proto":"tcp","state":"open","service":"ssh"},{"port":80,"proto":"tcp","state":"open","service":"http"}]', 0, 0],
  ['192.168.1.99', 'c8:d0:83:44:00:19', 'Espressif',         null,                  'offline', null, null,        '[]',                                                                                                0, 0],
]

const insertDevice = db.prepare(`
  INSERT INTO devices (mac, ip, vendor, hostname, status, first_seen, last_seen, last_online, updated_at, latency, os, ports, host_scripts, traceroute, favorited, flagged, dormant)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?)
`)

for (const [ip, mac, vendor, hostname, status, latency, os, ports, fav, flagged] of DEVICES) {
  const fs2 = ago(30 * DAY + Math.random() * 60 * DAY)
  const ls  = status === 'online' ? ago(Math.random() * 5 * MIN) : ago(2 * DAY + Math.random() * 5 * DAY)
  const lo  = status === 'online' ? ls : ago(2 * DAY)
  const dormant = status === 'offline' && (now - ls) > 3 * DAY ? 1 : 0
  insertDevice.run([mac, ip, vendor, hostname, status, fs2, ls, lo, ls, latency, os, ports, fav, flagged, dormant])
}
console.log(`  ✓ devices (${DEVICES.length})`)

// Favourites in device_flags
for (const [ip, mac,,,, ,,,fav, flagged] of DEVICES) {
  if (fav)     db.run('INSERT INTO device_flags (mac, flag_key, set_at) VALUES (?,?,?)', [mac, 'favorite', ago(10 * DAY)])
  if (flagged) db.run('INSERT INTO device_flags (mac, flag_key, set_at) VALUES (?,?,?)', [mac, 'pest',     ago(5  * DAY)])
}

// ── Device labels ─────────────────────────────────────────────────────────────
const LABELS = [
  ['dc:a6:32:11:00:01', 'Pi Router (fubar)'],
  ['b8:27:eb:22:00:02', 'Homelab Server'],
  ['00:11:32:88:00:08', 'Synology NAS'],
  ['dc:ef:ca:22:00:17', 'Pi-hole'],
]
for (const [mac, label] of LABELS) {
  db.run('INSERT INTO device_labels (mac, label, updated_at) VALUES (?,?,?)', [mac, label, ago(15 * DAY)])
}

// ── Speed tests ───────────────────────────────────────────────────────────────
// ~90 days of results at 4-hourly intervals (≈ 540 rows)
const insertSpeed = db.prepare(`
  INSERT INTO speedtest_results
    (ts, client_ip, client_isp, client_city, client_country, client_lat, client_lon,
     server_host, server_name, server_location, server_country,
     ping_ms, download_mbps, upload_mbps, via, provider)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

// Simulate gradual speed improvement over 90 days (ISP upgrade at day 60)
for (let i = 0; i < 540; i++) {
  const t       = ago(90 * DAY - i * 4 * HOUR)
  const phase   = i < 360 ? 0 : 1          // phase 1: plan upgrade
  const dlBase  = phase === 0 ? 220 : 460  // Mbps
  const ulBase  = phase === 0 ? 200 : 450
  const jitter  = () => (Math.random() - 0.5) * 30
  const dl      = Math.max(10, dlBase + jitter())
  const ul      = Math.max(10, ulBase + jitter())
  const ping    = 8 + Math.random() * 6
  insertSpeed.run([
    t, '203.0.113.42', 'Apex Fibre', 'Auckland', 'NZ', -36.86, 174.76,
    'speedtest.apexfibre.co.nz', 'Apex Fibre Auckland', 'Auckland', 'NZ',
    +ping.toFixed(1), +dl.toFixed(2), +ul.toFixed(2), 'direct', 'ookla',
  ])
}
// VPN speedtests (last 30 days, 6-hourly)
for (let i = 0; i < 120; i++) {
  const t  = ago(30 * DAY - i * 6 * HOUR)
  const dl = 180 + (Math.random() - 0.5) * 40
  const ul = 160 + (Math.random() - 0.5) * 40
  insertSpeed.run([
    t, '198.51.100.10', 'ProtonVPN', 'Zurich', 'CH', 47.38, 8.54,
    'speedtest.protonvpn.ch', 'ProtonVPN Zurich', 'Zurich', 'CH',
    +((12 + Math.random() * 8).toFixed(1)), +dl.toFixed(2), +ul.toFixed(2), 'vpn', 'ookla',
  ])
}
console.log('  ✓ speedtest_results (direct + VPN)')

// ── VPN state ─────────────────────────────────────────────────────────────────
db.run(
  `INSERT OR REPLACE INTO vpn_state
     (id, iface, client_ip, client_isp, client_city, client_country, client_lat, client_lon, updated_at)
   VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['tun0', '198.51.100.10', 'ProtonVPN', 'Zurich', 'CH', 47.38, 8.54, ago(10 * MIN)]
)
console.log('  ✓ vpn_state')

// ── Internet check audit events ───────────────────────────────────────────────
// Simulate 90 days of 5-minute checks with a few outages — use a single transaction
// and a VALUES list to avoid 25k individual inserts.
const insertAudit = db.prepare(
  'INSERT INTO audit_log (ts, event, actor, payload, ip) VALUES (?, ?, ?, ?, ?)'
)

// Outages: 3 short, 1 longer
const OUTAGES = [
  { start: ago(60 * DAY), durationMs: 8  * MIN  },
  { start: ago(45 * DAY), durationMs: 22 * MIN  },
  { start: ago(20 * DAY), durationMs: 4  * MIN  },
  { start: ago(7  * DAY), durationMs: 97 * MIN  },  // SLA-relevant
]

function isDown(t) {
  for (const o of OUTAGES) {
    if (t >= o.start && t <= o.start + o.durationMs) return true
  }
  return false
}

// Wrap all inserts in one transaction so node-sqlite3-wasm doesn't flush per row
db.exec('BEGIN')
for (let i = 0; i < 90 * 24 * 12; i++) {
  const t  = ago(90 * DAY - i * 5 * MIN)
  const up = !isDown(t)
  insertAudit.run([t, 'internet.check', 'system', JSON.stringify({ up, vpn_up: up, latency_ms: up ? +(18 + Math.random() * 10).toFixed(1) : null }), null])
}
db.exec('COMMIT')

// Outage down/up events
for (const o of OUTAGES) {
  insertAudit.run([o.start,                   'internet.down', 'system', JSON.stringify({ duration_ms: null }), null])
  insertAudit.run([o.start + o.durationMs,    'internet.up',   'system', JSON.stringify({ duration_ms: o.durationMs }), null])
}

// Outage diagnostics
db.run(
  `INSERT INTO outage_diagnostics (outage_ts, traceroute, ping_detail, gateway, outage_type, captured_at) VALUES (?, ?, ?, ?, ?, ?)`,
  [ago(7 * DAY), JSON.stringify([
    { hop: 1, ip: '192.168.1.1',   rtt: [0.4, 0.3, 0.4] },
    { hop: 2, ip: '10.0.0.1',      rtt: [8.1, 7.9, 8.2] },
    { hop: 3, ip: '203.0.113.1',   rtt: [null, null, null] },
    { hop: 4, ip: '1.1.1.1',       rtt: [null, null, null] },
  ]), JSON.stringify([
    { host: '1.1.1.1', ok: false },
    { host: '8.8.8.8', ok: false },
  ]), '192.168.1.1', 'full', ago(7 * DAY)]
)
console.log('  ✓ internet checks + outages')

// Scan events
for (let i = 0; i < 90; i++) {
  const t = ago(i * DAY + 2 * HOUR)
  insertAudit.run([t, 'scan.complete', 'system', JSON.stringify({ devices: DEVICES.length, duration_ms: 8000 + Math.random() * 4000 }), null])
}

// Device events: new devices discovered on day-1
const insertDevEvent = db.prepare(
  'INSERT INTO device_events (ts, event, mac, ip, hostname, payload) VALUES (?, ?, ?, ?, ?, ?)'
)
for (const [ip, mac, vendor, hostname] of DEVICES.slice(0, 16)) {
  insertDevEvent.run([ago(89 * DAY + Math.random() * DAY), 'device.new', mac, ip, hostname, JSON.stringify({ vendor })])
}
// Some online/offline transitions in the last 7 days
for (let i = 0; i < 30; i++) {
  const dev = DEVICES[Math.floor(Math.random() * 12) + 2]  // skip router+server
  const t   = ago(7 * DAY - i * 5 * HOUR)
  insertDevEvent.run([t, Math.random() > 0.5 ? 'device.online' : 'device.offline', dev[1], dev[0], dev[3], '{}'])
}

// Service check + config events
insertAudit.run([ago(2 * HOUR), 'scan.started',   'user',   '{}', '127.0.0.1'])
insertAudit.run([ago(1 * HOUR), 'config.saved',   'user',   JSON.stringify({ section: 'services' }), '127.0.0.1'])
insertAudit.run([ago(30 * MIN), 'threat.refresh', 'system', JSON.stringify({ added: 12 }), null])
insertAudit.run([ago(5  * MIN), 'ddns.updated',   'system', JSON.stringify({ ip: '203.0.113.42', hostname: 'my-homelab.duckdns.org' }), null])
insertAudit.run([ago(1  * MIN), 'service.check',  'system', JSON.stringify({ ok: 6, fail: 0 }), null])
console.log('  ✓ audit_log + device_events')

// ── DDNS files ────────────────────────────────────────────────────────────────
const ddnsStatus = {
  last_ip:      '203.0.113.42',
  last_updated: ago(5 * MIN),
  last_check:   ago(2 * MIN),
  last_error:   null,
}
fs.writeFileSync(path.join(OUT_DIR, 'ddns-status.json'), JSON.stringify(ddnsStatus, null, 2))

const ddnsHistory = Array.from({ length: 20 }, (_, i) => ({
  ts:       ago((i * 3 + Math.random()) * DAY),
  event:    i % 7 === 0 ? 'ip_changed' : 'dns_updated',
  ip:       i % 7 === 0 ? '203.0.113.' + (40 + i) : '203.0.113.42',
  hostname: 'my-homelab.duckdns.org',
  ok:       true,
})).sort((a, b) => b.ts - a.ts)
fs.writeFileSync(path.join(OUT_DIR, 'ddns-history.json'), JSON.stringify(ddnsHistory, null, 2))
console.log('  ✓ ddns-status.json + ddns-history.json')

// ── state.json (network scan results read by the frontend on load) ─────────────
const stateDevices = DEVICES.map(([ip, mac, vendor, hostname, status, latency, os, ports, fav]) => ({
  ip, mac, vendor, hostname, status,
  latency: status === 'online' ? latency : null,
  os: os ?? null,
  ports: JSON.parse(ports),
  hostScripts: [],
  traceroute:  [],
  firstSeen:   ago(30 * DAY),
  lastSeen:    status === 'online' ? ago(Math.random() * 5 * MIN) : ago(2 * DAY),
  lastOnline:  status === 'online' ? ago(Math.random() * 5 * MIN) : ago(2 * DAY),
  dormant:     status === 'offline' ? 1 : 0,
  favorited:   fav,
}))

const state = {
  devices:  stateDevices,
  lastScan: ago(5 * MIN),
  gateway:  '192.168.1.1',
  gatewayAssignments: {},
  seen_threats: [],
}
fs.writeFileSync(path.join(OUT_DIR, 'state.json'), JSON.stringify(state, null, 2))
console.log('  ✓ state.json')

db.close()
console.log(`\nDone — demo data in ${OUT_DIR}`)
console.log('\nTo run a local demo container:')
console.log(`  docker run -d --name claudette-demo --rm -p 7654:7654 -v "${OUT_DIR}:/app/data" claudette:latest`)
console.log('\nLogin: demo / demo')
