import { Router } from 'express'
import fs from 'fs'
import yaml from 'js-yaml'
import { getConfigPath, loadConfig, resetConfig, CONFIG_VERSION } from '../config.js'
import { audit } from '../db.js'

const router = Router()

router.get('/status', (req, res) => {
  const exists = fs.existsSync(getConfigPath())
  let valid = false
  let outdated = false
  if (exists) {
    const cfg = loadConfig()
    valid = !!(cfg && cfg.pi?.host)
    outdated = valid && (cfg.config_version ?? '') !== CONFIG_VERSION
  }
  res.json({ exists, valid, outdated })
})

// Return full current config (safe to expose on LAN)
router.get('/', (req, res) => {
  res.json(loadConfig() ?? {})
})

router.post('/', (req, res) => {
  const body = req.body ?? {}

  const sanitize = (v, re, max) => String(v ?? '').replace(re, '').slice(0, max)

  const piHost   = sanitize(body.pi?.host    ?? body.piHost  ?? '192.168.1.10', /[^0-9.]/g,      15)
  const piUser   = sanitize(body.pi?.ssh_user ?? body.piUser ?? 'ubuntu',        /[^a-zA-Z0-9_-]/g, 32)
  const sshKey   = sanitize(body.pi?.ssh_key  ?? body.sshKey ?? '',              /[^a-zA-Z0-9 _.~/:@-]/g, 128)
  const rawSubnets = Array.isArray(body.network?.subnets)
    ? body.network.subnets.map(s => sanitize(s, /[^0-9./]/g, 20)).filter(s => s)
    : (body.network?.subnet ? [sanitize(body.network.subnet, /[^0-9./]/g, 20)].filter(Boolean) : [])

  const services = Array.isArray(body.services)
    ? body.services.map(s => ({
        name: sanitize(s.name ?? '', /[^a-zA-Z0-9 _.:-]/g, 64),
        type: ['http', 'docker'].includes(s.type) ? s.type : 'http',
        url:  String(s.url ?? '').slice(0, 256),
        ...(s.expect_status ? { expect_status: parseInt(s.expect_status) || 200 } : {}),
      })).filter(s => s.name && s.url)
    : (loadConfig()?.services ?? [])

  const config = {
    config_version: CONFIG_VERSION,
    pi: { host: piHost, ssh_user: piUser, ...(sshKey ? { ssh_key: sshKey } : {}) },
    services,
    alerts:  { email: { enabled: false }, slack: { enabled: false } },
    threats: { keywords: [], severity_threshold: 'high' },
    schedule: {
      // Use Number.isFinite check so 0 is not treated as falsy (e.g. deep_scan_hour: 0 = midnight is valid)
      check_interval_minutes:   Math.max(1, (n => Number.isFinite(n) ? n : 5)(parseInt(body.schedule?.check_interval_minutes))),
      internet_check_minutes:   Math.max(1, (n => Number.isFinite(n) ? n : 5)(parseInt(body.schedule?.internet_check_minutes))),
      threat_interval_hours:    Math.max(1, (n => Number.isFinite(n) ? n : 6)(parseInt(body.schedule?.threat_interval_hours))),
      ping_interval_minutes:    Math.max(1, (n => Number.isFinite(n) ? n : 5)(parseInt(body.schedule?.ping_interval_minutes))),
      deep_scan_hour:           Math.min(23, Math.max(0, (n => Number.isFinite(n) ? n : 4)(parseInt(body.schedule?.deep_scan_hour)))),
      speedtest_interval_hours:     Math.max(1, (n => Number.isFinite(n) ? n : 4)(parseInt(body.schedule?.speedtest_interval_hours))),
      vpn_speedtest_interval_hours: Math.max(0, (n => Number.isFinite(n) ? n : 4)(parseInt(body.schedule?.vpn_speedtest_interval_hours))),
      backup_interval_days:     Math.max(0, (n => Number.isFinite(n) ? n : 0)(parseInt(body.schedule?.backup_interval_days))),
      backup_keep_days:              Math.min(365, Math.max(1, (n => Number.isFinite(n) ? n : 7)(parseInt(body.schedule?.backup_keep_days)))),
      internet_outage_check_seconds: Math.max(5, Math.min(300, (n => Number.isFinite(n) ? n : 10)(parseInt(body.schedule?.internet_outage_check_seconds)))),
      mtr_baseline_hours:       Math.max(0, Math.min(24, (n => Number.isFinite(n) ? n : 1)(parseInt(body.schedule?.mtr_baseline_hours)))),
      mtr_outage_repeat_minutes: Math.max(0, Math.min(60, (n => Number.isFinite(n) ? n : 15)(parseInt(body.schedule?.mtr_outage_repeat_minutes)))),
      speedtest_provider: ['cloudflare', 'ookla'].includes(body.schedule?.speedtest_provider)
        ? body.schedule.speedtest_provider : 'cloudflare',
    },
  }
  const existingNetwork = loadConfig()?.network ?? {}
  // Sanitize connectivity hosts: allow IPs and simple hostnames/URLs only
  const rawConnectivityHosts = Array.isArray(body.network?.connectivity_hosts)
    ? body.network.connectivity_hosts
        .map(h => sanitize(String(h), /[^a-zA-Z0-9.-]/g, 64))
        .filter(h => h)
        .slice(0, 5)
    : null
  config.network = { ...existingNetwork }
  if (rawSubnets.length) {
    config.network.subnets = rawSubnets
    delete config.network.subnet  // migrate away from old single-subnet key
  } else {
    delete config.network.subnets
    delete config.network.subnet
  }
  config.network.connectivity_hosts = rawConnectivityHosts ?? existingNetwork.connectivity_hosts ?? ['1.1.1.1']
  config.network.dormant_after_days = Math.max(1, Math.min(365, (n => Number.isFinite(n) ? n : 3)(parseInt(body.network?.dormant_after_days))))
  config.network.skull_after_days   = Math.max(1, Math.min(365, (n => Number.isFinite(n) ? n : 7)(parseInt(body.network?.skull_after_days))))
  // vpn_interface: allow Linux iface names (letters, digits, underscore, hyphen, max 15 chars)
  const rawVpnIface = body.network?.vpn_interface != null
    ? sanitize(String(body.network.vpn_interface), /[^a-zA-Z0-9_-]/g, 15).trim()
    : null
  if (rawVpnIface) config.network.vpn_interface = rawVpnIface
  else delete config.network.vpn_interface
  const rawFallbackDns = Array.isArray(body.network?.fallback_dns)
    ? body.network.fallback_dns
        .map(h => sanitize(String(h), /[^0-9a-fA-F.:]/g, 39))
        .filter(h => h)
        .slice(0, 3)
    : null
  config.network.fallback_dns = rawFallbackDns ?? existingNetwork.fallback_dns ?? []

  const VALID_THEMES = ['starfield','dark','nebula','aurora','synthwave','ocean','forest','volcanic','arctic','matrix','crimson','cobalt','amber','crystal','circuit','storm']
  const existingUi = loadConfig()?.ui ?? {}
  const themeId = VALID_THEMES.includes(body.ui?.theme)
    ? body.ui.theme
    : (existingUi.theme ?? 'starfield')
  config.ui = { ...existingUi, theme: themeId }

  const existingIsp = loadConfig()?.isp ?? {}
  config.isp = {
    name:                String(body.isp?.name                 ?? existingIsp.name                 ?? '').slice(0, 128),
    connection_type:     String(body.isp?.connection_type      ?? existingIsp.connection_type      ?? 'broadband').slice(0, 32),
    expected_uptime:     (v => isNaN(v) ? 100 : v)(parseFloat(body.isp?.expected_uptime ?? existingIsp.expected_uptime)),
    plan_download_mbps:  parseFloat(body.isp?.plan_download_mbps ?? existingIsp.plan_download_mbps ?? 0) || 0,
    plan_upload_mbps:    parseFloat(body.isp?.plan_upload_mbps   ?? existingIsp.plan_upload_mbps   ?? 0) || 0,
    account_number:      String(body.isp?.account_number        ?? existingIsp.account_number      ?? '').slice(0, 64),
    support_email:       String(body.isp?.support_email         ?? existingIsp.support_email        ?? '').slice(0, 128),
    sla_url:             String(body.isp?.sla_url               ?? existingIsp.sla_url              ?? '').slice(0, 512),
    sla_notes:           String(body.isp?.sla_notes             ?? existingIsp.sla_notes            ?? '').slice(0, 1024),
  }

  const existingInfra = loadConfig()?.infra ?? {}
  config.infra = {
    name:                String(body.infra?.name                 ?? existingInfra.name                 ?? '').slice(0, 128),
    connection_type:     String(body.infra?.connection_type      ?? existingInfra.connection_type      ?? 'fibre').slice(0, 32),
    sla_pct:             parseFloat(body.infra?.sla_pct          ?? existingInfra.sla_pct              ?? existingIsp.infra_sla_pct ?? 0) || 0,
    plan_download_mbps:  parseFloat(body.infra?.plan_download_mbps ?? existingInfra.plan_download_mbps ?? 0) || 0,
    plan_upload_mbps:    parseFloat(body.infra?.plan_upload_mbps   ?? existingInfra.plan_upload_mbps   ?? 0) || 0,
    account_number:      String(body.infra?.account_number        ?? existingInfra.account_number      ?? '').slice(0, 64),
    support_email:       String(body.infra?.support_email         ?? existingInfra.support_email        ?? '').slice(0, 128),
    sla_url:             String(body.infra?.sla_url               ?? existingInfra.sla_url              ?? '').slice(0, 512),
    sla_notes:           String(body.infra?.sla_notes             ?? existingInfra.sla_notes            ?? '').slice(0, 1024),
  }

  const existingRetention = loadConfig()?.retention ?? {}
  const retentionDays = [30, 60, 90, 180, 365, 730, 1095, 1825].includes(parseInt(body.retention?.days))
    ? parseInt(body.retention.days)
    : (existingRetention.days ?? 365)
  config.retention = { days: retentionDays }

  // ── DDNS settings ────────────────────────────────────────────────────────
  const existingDdns = loadConfig()?.ddns ?? {}
  const VALID_DDNS_PROVIDERS = ['noip', 'duckdns', 'dynu', 'dyndns', 'afraid', 'cloudflare']
  const rawDdns = body.ddns ?? null
  if (rawDdns !== null) {
    const provider = VALID_DDNS_PROVIDERS.includes(rawDdns.provider) ? rawDdns.provider : (existingDdns.provider ?? 'noip')
    config.ddns = {
      enabled:  rawDdns.enabled === true || rawDdns.enabled === 'true',
      provider,
      check_interval_minutes:   Math.max(5, Math.min(1440, parseInt(rawDdns.check_interval_minutes) || 5)),
      history_retention_days:    Math.max(1, Math.min(3650, parseInt(rawDdns.history_retention_days) || 365)),
      // Per-provider credential blocks — sanitize each field
      noip: {
        username: sanitize(rawDdns.noip?.username ?? existingDdns.noip?.username ?? '', /[^a-zA-Z0-9@._-]/g, 128),
        password: String(rawDdns.noip?.password ?? existingDdns.noip?.password ?? '').slice(0, 256),
        hostname: sanitize(rawDdns.noip?.hostname ?? existingDdns.noip?.hostname ?? '', /[^a-zA-Z0-9._-]/g, 128),
      },
      duckdns: {
        token:   sanitize(rawDdns.duckdns?.token   ?? existingDdns.duckdns?.token   ?? '', /[^a-zA-Z0-9_-]/g, 128),
        domains: sanitize(rawDdns.duckdns?.domains ?? existingDdns.duckdns?.domains ?? '', /[^a-zA-Z0-9,._-]/g, 256),
      },
      dynu: {
        username: sanitize(rawDdns.dynu?.username ?? existingDdns.dynu?.username ?? '', /[^a-zA-Z0-9@._-]/g, 128),
        password: String(rawDdns.dynu?.password ?? existingDdns.dynu?.password ?? '').slice(0, 256),
        hostname: sanitize(rawDdns.dynu?.hostname ?? existingDdns.dynu?.hostname ?? '', /[^a-zA-Z0-9._-]/g, 128),
      },
      dyndns: {
        username: sanitize(rawDdns.dyndns?.username ?? existingDdns.dyndns?.username ?? '', /[^a-zA-Z0-9@._-]/g, 128),
        password: String(rawDdns.dyndns?.password ?? existingDdns.dyndns?.password ?? '').slice(0, 256),
        hostname: sanitize(rawDdns.dyndns?.hostname ?? existingDdns.dyndns?.hostname ?? '', /[^a-zA-Z0-9._-]/g, 128),
      },
      afraid: {
        update_url: String(rawDdns.afraid?.update_url ?? existingDdns.afraid?.update_url ?? '').slice(0, 512),
      },
      cloudflare: {
        api_token: String(rawDdns.cloudflare?.api_token  ?? existingDdns.cloudflare?.api_token  ?? '').slice(0, 256),
        zone_id:   sanitize(rawDdns.cloudflare?.zone_id  ?? existingDdns.cloudflare?.zone_id   ?? '', /[^a-zA-Z0-9]/g, 64),
        record_id: sanitize(rawDdns.cloudflare?.record_id ?? existingDdns.cloudflare?.record_id ?? '', /[^a-zA-Z0-9]/g, 64),
        hostname:  sanitize(rawDdns.cloudflare?.hostname  ?? existingDdns.cloudflare?.hostname  ?? '', /[^a-zA-Z0-9._-]/g, 128),
      },
    }
  } else {
    config.ddns = existingDdns
  }

  try {
    fs.writeFileSync(getConfigPath(), yaml.dump(config))
    resetConfig()
    req.app.locals.reschedule?.()
    if (!req.query.silent) {
      audit('config.saved', { piHost, subnets: rawSubnets.length ? rawSubnets : null }, 'user', req.ip)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/config — wipe config file so the setup wizard runs again on next load
router.delete('/', (req, res) => {
  try {
    const p = getConfigPath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
    resetConfig()
    audit('config.deleted', {}, 'user', req.ip)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
