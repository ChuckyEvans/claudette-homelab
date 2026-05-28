// Unit tests for IP address utilities — these functions gate all nmap input.
// OWASP A03 (Injection) — validated IP/CIDR strings only reach the scanner.

import { describe, it, expect } from 'vitest'
import {
  ipToInt,
  intToIp,
  isPrivateIP,
  isPrivateCIDR,
  ipInCIDR,
  getCIDRHosts,
} from '../../server/utils/ip.js'

// ── ipToInt / intToIp ─────────────────────────────────────────────────────────

describe('ipToInt', () => {
  it('converts well-known address correctly', () => {
    expect(ipToInt('192.168.1.1')).toBe(3232235777)
  })
  it('handles 0.0.0.0', () => {
    expect(ipToInt('0.0.0.0')).toBe(0)
  })
  it('handles 255.255.255.255', () => {
    expect(ipToInt('255.255.255.255')).toBe(4294967295)
  })
})

describe('intToIp', () => {
  it('round-trips with ipToInt', () => {
    expect(intToIp(ipToInt('10.20.30.40'))).toBe('10.20.30.40')
  })
  it('converts 0 to 0.0.0.0', () => {
    expect(intToIp(0)).toBe('0.0.0.0')
  })
})

// ── isPrivateIP ───────────────────────────────────────────────────────────────
// Critical: only private-range IPs may be passed to nmap.

describe('isPrivateIP', () => {
  // RFC 1918 — 10.0.0.0/8
  it('accepts 10.x.x.x (RFC 1918 class A)', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true)
    expect(isPrivateIP('10.255.255.254')).toBe(true)
  })
  // RFC 1918 — 172.16.0.0/12
  it('accepts 172.16–31.x.x (RFC 1918 class B)', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true)
    expect(isPrivateIP('172.31.255.254')).toBe(true)
  })
  it('rejects 172.15.x.x (just outside /12)', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false)
  })
  it('rejects 172.32.x.x (just outside /12)', () => {
    expect(isPrivateIP('172.32.0.1')).toBe(false)
  })
  // RFC 1918 — 192.168.0.0/16
  it('accepts 192.168.x.x (RFC 1918 class C)', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true)
    expect(isPrivateIP('192.168.255.254')).toBe(true)
  })
  // Public IPs — must be rejected
  it('rejects public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)    // Google DNS
    expect(isPrivateIP('1.1.1.1')).toBe(false)    // Cloudflare
    expect(isPrivateIP('203.0.113.1')).toBe(false) // TEST-NET-3
  })
  it('rejects non-IP strings', () => {
    expect(isPrivateIP('notanip')).toBe(false)
    expect(isPrivateIP('')).toBe(false)
    expect(isPrivateIP('192.168.1')).toBe(false)
  })
})

// ── isPrivateCIDR ─────────────────────────────────────────────────────────────

describe('isPrivateCIDR', () => {
  it('accepts private CIDR', () => {
    expect(isPrivateCIDR('192.168.8.0/24')).toBe(true)
    expect(isPrivateCIDR('10.0.0.0/8')).toBe(true)
    expect(isPrivateCIDR('172.16.0.0/12')).toBe(true)
  })
  it('rejects public CIDR', () => {
    expect(isPrivateCIDR('8.8.8.0/24')).toBe(false)
    expect(isPrivateCIDR('1.0.0.0/8')).toBe(false)
  })
  it('rejects malformed CIDR', () => {
    expect(isPrivateCIDR('notacidr')).toBe(false)
    expect(isPrivateCIDR('192.168.1.0')).toBe(false) // missing prefix
    expect(isPrivateCIDR('192.168.1.0/33')).toBe(false) // invalid prefix (> 32)
  })
})

// ── ipInCIDR ──────────────────────────────────────────────────────────────────

describe('ipInCIDR', () => {
  it('detects IP within /24', () => {
    expect(ipInCIDR('192.168.8.100', '192.168.8.0/24')).toBe(true)
    expect(ipInCIDR('192.168.8.1',   '192.168.8.0/24')).toBe(true)
    expect(ipInCIDR('192.168.8.254', '192.168.8.0/24')).toBe(true)
  })
  it('rejects IP outside /24', () => {
    expect(ipInCIDR('192.168.9.1', '192.168.8.0/24')).toBe(false)
    expect(ipInCIDR('10.0.0.1',    '192.168.8.0/24')).toBe(false)
  })
  it('returns false for malformed CIDR', () => {
    expect(ipInCIDR('192.168.8.1', 'bad')).toBe(false)
  })
  it('returns false for prefix > 32', () => {
    expect(ipInCIDR('192.168.8.1', '192.168.8.0/33')).toBe(false)
  })
})

// ── getCIDRHosts ──────────────────────────────────────────────────────────────

describe('getCIDRHosts', () => {
  it('returns 254 hosts for /24', () => {
    const hosts = getCIDRHosts('192.168.8.0/24')
    expect(hosts).toHaveLength(254)
  })
  it('first host is .1 and last host is .254 for /24', () => {
    const hosts = getCIDRHosts('192.168.8.0/24')
    expect(hosts[0]).toBe('192.168.8.1')
    expect(hosts[253]).toBe('192.168.8.254')
  })
  it('returns 14 hosts for /28', () => {
    const hosts = getCIDRHosts('192.168.1.0/28')
    expect(hosts).toHaveLength(14)
    expect(hosts[0]).toBe('192.168.1.1')
    expect(hosts[13]).toBe('192.168.1.14')
  })
  it('returns 510 hosts for /23', () => {
    expect(getCIDRHosts('192.168.0.0/23')).toHaveLength(510)
  })
  it('returns null for /8 (too large — prevents huge scans)', () => {
    expect(getCIDRHosts('10.0.0.0/8')).toBeNull()
  })
  it('returns null for /15 (just below the /16 limit)', () => {
    expect(getCIDRHosts('172.16.0.0/15')).toBeNull()
  })
  it('returns 65534 hosts for /16', () => {
    expect(getCIDRHosts('192.168.0.0/16')).toHaveLength(65534)
  })
  it('returns null for malformed CIDR', () => {
    expect(getCIDRHosts('notacidr')).toBeNull()
    expect(getCIDRHosts('192.168.1.0')).toBeNull()
  })
  it('returns null for prefix > 32', () => {
    expect(getCIDRHosts('192.168.1.0/33')).toBeNull()
  })
})
