// Pure IP address utility functions — separated for testability.
// These are the security gatekeepers for the network scanner:
// any IP or CIDR used by nmap must pass isPrivateIP / isPrivateCIDR first.

export function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) | (parseInt(o) & 0xff), 0) >>> 0
}

export function intToIp(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

/** Returns true if the IP falls within one of the three RFC 1918 private ranges. */
export function isPrivateIP(ip) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false
  const n = ipToInt(ip)
  return (
    (n >= ipToInt('10.0.0.0')    && n <= ipToInt('10.255.255.255'))  ||  // /8
    (n >= ipToInt('172.16.0.0')  && n <= ipToInt('172.31.255.255'))  ||  // /12
    (n >= ipToInt('192.168.0.0') && n <= ipToInt('192.168.255.255'))      // /16
  )
}

/** Returns true if the CIDR network address is within a private range. */
export function isPrivateCIDR(cidr) {
  const m = cidr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/)
  if (!m) return false
  if (parseInt(m[2]) > 32) return false
  return isPrivateIP(m[1])
}

/** Returns true if the given IP falls within the CIDR block. */
export function ipInCIDR(ip, cidr) {
  const m = cidr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/)
  if (!m) return false
  const prefix = parseInt(m[2])
  if (prefix > 32) return false
  const mask = (~0 << (32 - prefix)) >>> 0
  return (ipToInt(ip) & mask) === (ipToInt(m[1]) & mask)
}

/** Enumerates all host IPs in a CIDR. Returns null for subnets larger than /16. */
export function getCIDRHosts(cidr) {
  const m = cidr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/)
  if (!m) return null
  const prefix = parseInt(m[2])
  if (prefix < 16 || prefix > 32) return null
  const count = 1 << (32 - prefix)
  const mask  = (~0 << (32 - prefix)) >>> 0
  const base  = ipToInt(m[1]) & mask
  const hosts = []
  for (let i = 1; i < count - 1; i++) hosts.push(intToIp(base | i))
  return hosts
}
