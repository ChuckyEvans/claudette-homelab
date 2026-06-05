// DDNS (Dynamic DNS) updater
// Checks public IP every N minutes; pushes update to the configured provider when IP changes.
//
// Supported providers:
//   noip       — No-IP (dynupdate.no-ip.com)
//   duckdns    — DuckDNS
//   dynu       — Dynu
//   dyndns     — DynDNS / Dyn
//   afraid     — Afraid.org / FreeDNS (direct update URL)
//   cloudflare — Cloudflare DNS API

import fs from 'fs'
import net from 'net'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getDataDir } from '../db.js'

const execFileAsync = promisify(execFile)

const STATUS_FILE  = () => path.join(getDataDir(), 'ddns-status.json')
const HISTORY_FILE = () => path.join(getDataDir(), 'ddns-history.json')
const HISTORY_MAX  = 200

export function readDdnsStatus() {
  try {
    if (fs.existsSync(STATUS_FILE())) {
      return JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8'))
    }
  } catch {}
  return { last_ip: null, last_updated: null, last_check: null, last_error: null }
}

export function writeDdnsStatus(data) {  try {
    const dir = getDataDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(STATUS_FILE(), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('[ddns] Failed to write status:', e.message)
  }
}

export function readDdnsHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE())) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE(), 'utf8'))
    }
  } catch {}
  return []
}

function appendDdnsHistory(entry, retentionDays = 365) {
  try {
    const dir = getDataDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const ttl = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
    const cutoff = Date.now() - ttl
    const history = readDdnsHistory().filter(e => (e.ts ?? 0) >= cutoff)
    history.unshift(entry)          // newest first
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX
    fs.writeFileSync(HISTORY_FILE(), JSON.stringify(history, null, 2))
  } catch (e) {
    console.error('[ddns] Failed to write history:', e.message)
  }
}

// ── Port scan ─────────────────────────────────────────────────────────────────
// Probes each port via TCP connect. Works on most home networks (hairpin NAT permitting).
// Does NOT require root or nmap — pure Node.js net.createConnection().

const DEFAULT_PORTS = [21, 22, 25, 80, 443, 3389, 8080, 8443, 25565, 32400, 51820]

const PORT_SERVICES = {
  21: 'FTP', 22: 'SSH', 25: 'SMTP', 80: 'HTTP', 443: 'HTTPS',
  3389: 'RDP', 8080: 'HTTP-alt', 8443: 'HTTPS-alt',
  25565: 'Minecraft', 32400: 'Plex', 51820: 'WireGuard',
}

function probePort(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port })
    socket.setTimeout(timeoutMs)
    const done = (open) => { socket.destroy(); resolve({ port, open, service: PORT_SERVICES[port] ?? null }) }
    socket.on('connect', () => done(true))
    socket.on('error',   () => done(false))
    socket.on('timeout', () => done(false))
  })
}

export async function scanPorts(ip, ports = DEFAULT_PORTS) {
  const results = await Promise.all(ports.map(p => probePort(ip, p)))
  return { ts: Date.now(), ip, results }
}

// ── Public IP detection (multiple fallbacks) ─────────────────────────────────
// Uses curl --interface eth0 so the request bypasses any active VPN tunnel.
// Falls back to plain fetch if curl is unavailable (e.g. non-Linux environments).
async function getPublicIp() {
  const urls = [
    'https://api4.my-ip.io/ip',
    'https://ipv4.icanhazip.com',
    'https://checkip.amazonaws.com',
  ]
  // Try curl bound to eth0 first (avoids VPN routing)
  for (const url of urls) {
    try {
      const { stdout } = await execFileAsync('curl', [
        '--interface', 'eth0',
        '--silent', '--max-time', '8', '--ipv4', url
      ])
      const ip = stdout.trim()
      if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip
    } catch {}
  }
  // Fallback: plain fetch (will use default route — may go via VPN)
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const ip = (await res.text()).trim()
      if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip
    } catch {}
  }
  throw new Error('Could not determine public IP from any source')
}

// ── Per-provider update functions ────────────────────────────────────────────
async function updateNoIp(cfg, ip) {
  const { username, password, hostname } = cfg
  const url = `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(hostname)}&myip=${ip}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      'User-Agent': 'Claudette-DDNS/1.0 homelab',
    },
  })
  const text = (await res.text()).trim()
  if (text.startsWith('good') || text.startsWith('nochg')) return { response: text }
  throw new Error(`No-IP: ${text}`)
}

async function updateDuckDns(cfg, ip) {
  const { token, domains } = cfg
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(domains)}&token=${token}&ip=${ip}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Claudette-DDNS/1.0 homelab' } })
  const text = (await res.text()).trim()
  if (text === 'OK') return { response: text }
  throw new Error(`DuckDNS: ${text}`)
}

async function updateDynu(cfg, ip) {
  const { username, password, hostname } = cfg
  const url = `https://api.dynu.com/nic/update?hostname=${encodeURIComponent(hostname)}&myip=${ip}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      'User-Agent': 'Claudette-DDNS/1.0 homelab',
    },
  })
  const text = (await res.text()).trim()
  if (text.startsWith('good') || text.startsWith('nochg')) return { response: text }
  throw new Error(`Dynu: ${text}`)
}

async function updateDynDns(cfg, ip) {
  const { username, password, hostname } = cfg
  const url = `https://members.dyndns.org/v3/update?hostname=${encodeURIComponent(hostname)}&myip=${ip}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
      'User-Agent': 'Claudette-DDNS/1.0 homelab',
    },
  })
  const text = (await res.text()).trim()
  if (text.startsWith('good') || text.startsWith('nochg')) return { response: text }
  throw new Error(`DynDNS: ${text}`)
}

async function updateAfraid(cfg, ip) {
  const { update_url } = cfg
  // Afraid.org supports appending address param to their per-record update URL
  const url = update_url.includes('?') ? `${update_url}&address=${ip}` : `${update_url}?address=${ip}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Claudette-DDNS/1.0 homelab' } })
  const text = (await res.text()).trim()
  if (res.ok) return { response: text.slice(0, 128) || 'OK' }
  throw new Error(`Afraid.org: HTTP ${res.status}`)
}

async function updateCloudflare(cfg, ip) {
  const { api_token, zone_id, record_id, hostname } = cfg
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records/${record_id}`, {
    method: 'PATCH',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Authorization': `Bearer ${api_token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Claudette-DDNS/1.0 homelab',
    },
    body: JSON.stringify({ type: 'A', name: hostname, content: ip, ttl: 60, proxied: false }),
  })
  const data = await res.json()
  if (data.success) return { response: 'Updated' }
  throw new Error(`Cloudflare: ${data.errors?.[0]?.message ?? 'unknown error'}`)
}

// ── Main entrypoint ───────────────────────────────────────────────────────────
export async function checkAndUpdateDdns(cfg, { force = false, triggeredBy = 'system' } = {}) {
  if (!cfg?.ddns?.enabled) return

  const provider    = cfg.ddns.provider
  const providerCfg = cfg.ddns[provider] ?? {}
  const status      = readDdnsStatus()
  const now         = Date.now()

  let ip
  try {
    ip = await getPublicIp()
  } catch (err) {
    writeDdnsStatus({ ...status, last_check: now, last_error: err.message })
    console.error('[ddns] IP check failed:', err.message)
    return
  }

  // Determine if a port scan is due
  const portPorts      = cfg.ddns.port_check_ports ?? DEFAULT_PORTS
  const portIntervalMs = (cfg.ddns.port_check_interval_minutes ?? 60) * 60 * 1000
  const lastScanTs     = status.port_scan?.ts ?? 0
  const scanDue        = portPorts.length > 0 && (force || (now - lastScanTs) >= portIntervalMs)

  // Skip DDNS update if IP is unchanged (unless force=true)
  if (!force && ip === status.last_ip) {
    const newStatus = { ...status, last_check: now, last_error: null }
    if (scanDue) {
      console.log(`[ddns] Running port scan on ${ip}…`)
      try {
        const scan = await scanPorts(ip, portPorts)
        newStatus.port_scan = scan
        appendDdnsHistory({ ts: now, event: 'port_scan', ip, results: scan.results, triggered_by: triggeredBy }, cfg.ddns.history_retention_days)
        console.log(`[ddns] Port scan done: ${scan.results.filter(r => r.open).length}/${scan.results.length} open`)
      } catch (scanErr) {
        console.warn('[ddns] Port scan failed:', scanErr.message)
      }
    } else {
      console.log(`[ddns] IP unchanged (${ip}), no update needed`)
    }
    writeDdnsStatus(newStatus)
    return
  }

  console.log(`[ddns] IP ${force ? '(force)' : `changed: ${status.last_ip ?? '?'} →`} ${ip} — updating ${provider}…`)

  try {
    let result
    switch (provider) {
      case 'noip':       result = await updateNoIp(providerCfg, ip);       break
      case 'duckdns':    result = await updateDuckDns(providerCfg, ip);    break
      case 'dynu':       result = await updateDynu(providerCfg, ip);       break
      case 'dyndns':     result = await updateDynDns(providerCfg, ip);     break
      case 'afraid':     result = await updateAfraid(providerCfg, ip);     break
      case 'cloudflare': result = await updateCloudflare(providerCfg, ip); break
      default: throw new Error(`Unknown provider: ${provider}`)
    }
    const ipActuallyChanged = ip !== status.last_ip
    const newStatus = { last_ip: ip, last_updated: now, last_check: now, last_error: null, provider, response: result.response }

    // Always scan on IP change or force; otherwise respect interval
    if (portPorts.length > 0 && (ipActuallyChanged || scanDue)) {
      console.log(`[ddns] Running port scan on ${ip}…`)
      try {
        const scan = await scanPorts(ip, portPorts)
        newStatus.port_scan = scan
        appendDdnsHistory({ ts: now, event: 'port_scan', ip, results: scan.results, triggered_by: triggeredBy }, cfg.ddns.history_retention_days)
        console.log(`[ddns] Port scan done: ${scan.results.filter(r => r.open).length}/${scan.results.length} open`)
      } catch (scanErr) {
        console.warn('[ddns] Port scan failed:', scanErr.message)
      }
    }

    writeDdnsStatus(newStatus)
    appendDdnsHistory({ ts: now, event: ipActuallyChanged ? 'ip_changed' : 'force_update', old_ip: status.last_ip ?? null, new_ip: ip, provider, response: result.response, triggered_by: triggeredBy }, cfg.ddns.history_retention_days)
    console.log(`[ddns] Update OK: ${result.response}`)
  } catch (err) {
    writeDdnsStatus({ ...status, last_ip: ip, last_check: now, last_error: err.message })
    appendDdnsHistory({ ts: now, event: 'update_failed', ip, provider, error: err.message, triggered_by: triggeredBy }, cfg.ddns.history_retention_days)
    console.error('[ddns] Update failed:', err.message)
  }
}
