/**
 * Client-side heuristic: match a threat to network devices / configured services.
 *
 * Strategy:
 *   1. Tokenise the threat's package name and cleaned-up title.
 *   2. Tokenise each configured service name → if any token overlaps, map the
 *      service URL's host IP to a device.
 *   3. Tokenise each device's hostname and user label → if any token overlaps,
 *      include that device.
 *
 * This is intentionally fuzzy; it won't catch every case but avoids spamming
 * false positives from noise words.
 */

const STOP = new Set([
  'with','from','the','and','for','via','this','that',
  'http','https','null','none','invalid',
  'code','file','data','user','system','name',
  'remote','local','injection','execution','overflow',
  'bypass','privilege','vulnerability','advisory',
  'critical','package','unknown','server','linux',
  'windows','macos','docker','java','ruby','node',
])

function tokenize(s) {
  return (s ?? '')
    .toLowerCase()
    // Strip CVE/GHSA prefix e.g. "CVE-2024-1234 | Critical | "
    .replace(/^(?:cve|ghsa)-[\w-]+\s*(?:\|\s*[\w]+\s*\|\s*)?/i, '')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !STOP.has(w))
}

/**
 * Returns the list of devices that appear to be affected by `threat`.
 * @param {object} threat          - { package, title, severity, ... }
 * @param {object[]} devices       - networkScan.devices
 * @param {object[]} serviceResults - services.results  (each has .name and .url)
 */
export function matchDevices(threat, devices = [], serviceResults = []) {
  const tokens = new Set([
    ...tokenize(threat.package),
    ...tokenize(threat.title),
  ])
  if (tokens.size === 0) return []

  const ips = new Set()

  // ── Match against configured service names ───────────────────────────────
  for (const svc of serviceResults) {
    const svcTokens = tokenize(svc.name)
    if (svcTokens.some(t => tokens.has(t))) {
      try {
        const host = new URL(svc.url).hostname
        if (/^\d/.test(host)) {
          ips.add(host)
        } else {
          // hostname → resolve to IP via device list
          devices.forEach(d => {
            if ((d.hostname ?? '').toLowerCase() === host.toLowerCase()) ips.add(d.ip)
          })
        }
      } catch { /* malformed URL — skip */ }
    }
  }

  // ── Match against device hostname / label ────────────────────────────────
  for (const dev of devices) {
    const devTokens = new Set([
      ...tokenize(dev.hostname),
      ...tokenize(dev.label),
    ])
    if ([...devTokens].some(t => tokens.has(t))) ips.add(dev.ip)
  }

  return [...ips]
    .map(ip => devices.find(d => d.ip === ip) ?? { ip })
    .filter(Boolean)
}

const SEV_ORDER = { critical: 4, high: 3, medium: 2, low: 1 }

/**
 * Returns the worst threat severity for a given device IP, or null if none.
 */
export function deviceThreatLevel(ip, threats = [], devices = [], serviceResults = []) {
  let worst = 0
  let worstSev = null
  for (const t of threats) {
    const level = SEV_ORDER[t.severity] ?? 0
    if (level <= worst) continue // can't improve, skip expensive match
    if (matchDevices(t, devices, serviceResults).some(d => d.ip === ip)) {
      worst = level
      worstSev = t.severity
    }
  }
  return worstSev
}
