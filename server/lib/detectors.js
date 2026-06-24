import db from '../db.js'
import alerts from './alerts.js'

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

export default { detectIpClashes, detectMacIpChurn, detectPortScans, detectBeacons, persistIpClashes, persistMacIpChurn, persistPortScans, persistBeacons }
