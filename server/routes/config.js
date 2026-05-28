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
      speedtest_interval_hours: Math.max(1, (n => Number.isFinite(n) ? n : 1)(parseInt(body.schedule?.speedtest_interval_hours))),
      backup_interval_days:     Math.max(0, (n => Number.isFinite(n) ? n : 0)(parseInt(body.schedule?.backup_interval_days))),
      backup_keep_days:         Math.min(365, Math.max(1, (n => Number.isFinite(n) ? n : 7)(parseInt(body.schedule?.backup_keep_days)))),
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
    expected_uptime:     parseFloat(body.isp?.expected_uptime  ?? existingIsp.expected_uptime      ?? 100) || 100,
    plan_download_mbps:  parseFloat(body.isp?.plan_download_mbps ?? existingIsp.plan_download_mbps ?? 0) || 0,
    plan_upload_mbps:    parseFloat(body.isp?.plan_upload_mbps   ?? existingIsp.plan_upload_mbps   ?? 0) || 0,
    account_number:      String(body.isp?.account_number        ?? existingIsp.account_number      ?? '').slice(0, 64),
    support_email:       String(body.isp?.support_email         ?? existingIsp.support_email        ?? '').slice(0, 128),
  }

  const existingRetention = loadConfig()?.retention ?? {}
  const retentionDays = [30, 60, 90, 180, 365].includes(parseInt(body.retention?.days))
    ? parseInt(body.retention.days)
    : (existingRetention.days ?? 90)
  config.retention = { days: retentionDays }

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
