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
import path from 'path'
import { getDataDir } from '../db.js'

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

function writeDdnsStatus(data) {
  try {
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

// ── Public IP detection (multiple fallbacks) ─────────────────────────────────
async function getPublicIp() {
  const sources = [
    { url: 'https://api.ipify.org?format=json', json: true,  key: 'ip' },
    { url: 'https://ipv4.icanhazip.com',         json: false },
    { url: 'https://checkip.amazonaws.com',      json: false },
  ]
  for (const src of sources) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      let ip
      if (src.json) {
        ip = (await res.json())[src.key]
      } else {
        ip = (await res.text()).trim()
      }
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
export async function checkAndUpdateDdns(cfg, { force = false } = {}) {
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

  // Skip update if IP is unchanged (unless force=true)
  if (!force && ip === status.last_ip) {
    writeDdnsStatus({ ...status, last_check: now, last_error: null })
    console.log(`[ddns] IP unchanged (${ip}), no update needed`)
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
    writeDdnsStatus({ last_ip: ip, last_updated: now, last_check: now, last_error: null, provider, response: result.response })
    appendDdnsHistory({ ts: now, event: 'ip_changed', old_ip: status.last_ip ?? null, new_ip: ip, provider, response: result.response }, cfg.ddns.history_retention_days)
    console.log(`[ddns] Update OK: ${result.response}`)
  } catch (err) {
    writeDdnsStatus({ ...status, last_ip: ip, last_check: now, last_error: err.message })
    appendDdnsHistory({ ts: now, event: 'update_failed', ip, provider, error: err.message }, cfg.ddns.history_retention_days)
    console.error('[ddns] Update failed:', err.message)
  }
}
