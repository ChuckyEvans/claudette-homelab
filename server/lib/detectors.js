import db from '../db.js'

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
  } catch (_) {
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
  } catch (_) {
    return []
  }
}

export default { detectIpClashes, detectMacIpChurn, detectPortScans, detectBeacons }
