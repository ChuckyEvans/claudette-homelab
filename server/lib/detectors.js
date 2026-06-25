import { getDb } from '../db.js'
import alerts from './alerts.js'

const db = getDb()

// Very small, cheap detectors using recent ip_history rows.
export async function detectIpClashes(limit = 100) {
  const rows = await db.all(`
    SELECT ip, GROUP_CONCAT(DISTINCT mac) as macs, COUNT(DISTINCT mac) as mac_count, MAX(ts) as last_seen
    FROM ip_history
    GROUP BY ip
    HAVING mac_count > 1
    ORDER BY last_seen DESC
    LIMIT ?
  `, [limit])
  return rows.map(r => ({ ip: r.ip, macs: r.macs ? r.macs.split(',') : [], mac_count: r.mac_count, last_seen: r.last_seen }))
}

// Persist simple IP clash alerts
export async function persistIpClashes(limit = 100) {
  const clashes = await detectIpClashes(limit)
  for (const c of clashes) {
    alerts.upsertAlert('ip_clash', c.ip, c)
  }
  return clashes
}

export async function persistMacIpChurn(limit = 100) {
  const churn = await detectMacIpChurn(limit)
  for (const c of churn) {
    alerts.upsertAlert('mac_ip_churn', c.mac, c)
  }
  return churn
}

export async function persistPortScans(limit = 100) {
  const scans = await detectPortScans(limit)
  for (const s of scans) {
    alerts.upsertAlert('port_scan', s.ip, s)
  }
  return scans
}

export async function persistBeacons(limit = 100) {
  const beacons = await detectBeacons(limit)
  for (const b of beacons) {
    alerts.upsertAlert('beacon', b.mac, b)
  }
  return beacons
}

export async function detectMacIpChurn(limit = 100) {
  const rows = await db.all(`
    SELECT mac, COUNT(DISTINCT ip) as ip_count, GROUP_CONCAT(DISTINCT ip) as ips, MAX(ts) as last_seen
    FROM ip_history
    GROUP BY mac
    HAVING ip_count > 1
    ORDER BY last_seen DESC
    LIMIT ?
  `, [limit])
  return rows.map(r => ({ mac: r.mac, ip_count: r.ip_count, ips: r.ips ? r.ips.split(',') : [], last_seen: r.last_seen }))
}

// Port-scan detector: find IPs with many distinct ports seen in recent scans table (if exists)
export async function detectPortScans(limit = 100) {
  try {
    const rows = await db.all(`
      SELECT ip, COUNT(DISTINCT port) as port_count, GROUP_CONCAT(DISTINCT port) as ports
      FROM port_scans
      GROUP BY ip
      HAVING port_count > 5
      ORDER BY MAX(ts) DESC
      LIMIT ?
    `, [limit])
    return rows.map(r => ({ ip: r.ip, port_count: r.port_count, ports: r.ports ? r.ports.split(',') : [] }))
  } catch {
    return []
  }
}

// Beacon detector: devices that pinged many times recently (simple heuristic)
export async function detectBeacons(limit = 100) {
  try {
    const rows = await db.all(`
      SELECT mac, COUNT(*) as hits, MAX(ts) as last_seen
      FROM ip_history
      GROUP BY mac
      HAVING hits > 20
      ORDER BY last_seen DESC
      LIMIT ?
    `, [limit])
    return rows.map(r => ({ mac: r.mac, hits: r.hits, last_seen: r.last_seen }))
  } catch {
    return []
  }
}

// Authentication failure detector: find usernames or IPs with many failed logins
export async function detectAuthFailures(limit = 100, windowMinutes = 60, threshold = 5) {
  try {
    const cutoff = Date.now() - (Number(windowMinutes) || 60) * 60_000
    const rows = await db.all(`
      SELECT ip, event, actor, COUNT(*) as fails, MAX(ts) as last_seen
      FROM audit_log
      WHERE event = 'auth.login_failed' AND ts >= ?
      GROUP BY ip
      HAVING fails >= ?
      ORDER BY last_seen DESC
      LIMIT ?
    `, [cutoff, threshold, limit])
    return rows.map(r => ({ ip: r.ip, fails: r.fails, last_seen: r.last_seen }))
  } catch {
    return []
  }
}

export async function persistAuthFailures(limit = 100) {
  const fails = await detectAuthFailures(limit)
  for (const f of fails) {
    const key = f.ip || `user:${f.actor}`
    await alerts.upsertAlert('auth_failed', key, f)
  }
  return fails
}

// Threat-feed matcher: find devices that mention a package/keyword from cached threats
export async function detectThreatMatches(limit = 100) {
  try {
    // get cached threats dynamically to avoid circular import
    const threatsModule = await import('../routes/threats.js')
    const threats = threatsModule.getCachedThreats?.() ?? []
    if (!threats.length) return []
    const matches = []
    for (const t of threats.slice(0, 200)) {
      if (!t.package) continue
      const like = `%${t.package.replace(/%/g, '')}%`
      const rows = await db.all(`SELECT mac, ip, hostname, os FROM devices WHERE hostname LIKE ? OR os LIKE ? LIMIT ?`, [like, like, limit])
      for (const r of rows) {
        matches.push({ threat: t.id, package: t.package, mac: r.mac, ip: r.ip, hostname: r.hostname, os: r.os })
        if (matches.length >= limit) break
      }
      if (matches.length >= limit) break
    }
    return matches
  } catch {
    return []
  }
}

export async function persistThreatMatches(limit = 100) {
  const matches = await detectThreatMatches(limit)
  for (const m of matches) {
    const key = `${m.threat}:${m.mac ?? m.ip}`
    await alerts.upsertAlert('threat_match', key, m)
  }
  return matches
}

export default { detectIpClashes, detectMacIpChurn, detectPortScans, detectBeacons, persistIpClashes, persistMacIpChurn, persistPortScans, persistBeacons }
