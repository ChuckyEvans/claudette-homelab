// Unit tests for src/lib/threatMatch.js
// Direct import — no browser APIs used in this module.

import { describe, it, expect } from 'vitest'
import { matchDevices, deviceThreatLevel } from '../../src/lib/threatMatch.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function device(ip, hostname = '', label = '') {
  return { ip, hostname, label, status: 'online' }
}

function service(name, url) {
  return { name, url }
}

function threat(pkg, title, severity = 'high') {
  return { package: pkg, title, severity }
}

// ── Empty / trivial inputs ────────────────────────────────────────────────────

describe('matchDevices() — empty / trivial inputs', () => {
  it('returns [] when all args are empty', () => {
    expect(matchDevices(threat('', ''), [], [])).toEqual([])
  })

  it('returns [] when no devices or services provided', () => {
    expect(matchDevices(threat('nginx', 'Nginx buffer overflow'), [], [])).toEqual([])
  })

  it('returns [] when tokens are all stop words', () => {
    // "the and with" → all filtered out
    expect(matchDevices(threat('the and', 'with from'), [device('10.0.0.1')], [])).toEqual([])
  })

  it('returns [] when tokens are all ≤3 chars', () => {
    expect(matchDevices(threat('ok go do', 'x y z ab'), [device('10.0.0.1')], [])).toEqual([])
  })
})

// ── CVE prefix stripping ──────────────────────────────────────────────────────

describe('tokenize — CVE prefix stripping', () => {
  it('strips CVE prefix so actual tokens are checked', () => {
    // "CVE-2024-1234" alone yields no meaningful token after stripping
    const result = matchDevices(
      threat('CVE-2024-1234', 'nginx buffer overflow in request parsing'),
      [device('10.0.0.1', 'nginx-host')],
      []
    )
    // 'nginx' (5 chars, not a stop word) in title → should match hostname token 'nginx'
    expect(result.some(d => d.ip === '10.0.0.1')).toBe(true)
  })
})

// ── Service name matching ─────────────────────────────────────────────────────

describe('matchDevices() — service name match', () => {
  it('matches service by name token and resolves IP from URL', () => {
    const devices  = [device('192.168.1.10')]
    const services = [service('nginx proxy', 'http://192.168.1.10:8080')]
    const result   = matchDevices(threat('nginx', 'nginx heap overflow'), devices, services)
    expect(result.some(d => d.ip === '192.168.1.10')).toBe(true)
  })

  it('resolves hostname URL to device IP via device list', () => {
    const devices  = [device('192.168.1.20', 'myserver')]
    const services = [service('myserver web', 'http://myserver:3000')]
    const result   = matchDevices(threat('myserver', 'Myserver vulnerability'), devices, services)
    expect(result.some(d => d.ip === '192.168.1.20')).toBe(true)
  })

  it('skips service with malformed URL gracefully', () => {
    const devices  = [device('10.0.0.1')]
    const services = [service('nginx', 'NOT_A_URL')]
    expect(() => matchDevices(threat('nginx', 'nginx issue'), devices, services)).not.toThrow()
  })

  it('does not duplicate when same IP matched via multiple services', () => {
    const devices  = [device('192.168.1.5')]
    const services = [
      service('nginx load balancer', 'http://192.168.1.5:80'),
      service('nginx cache',         'http://192.168.1.5:8080'),
    ]
    const result = matchDevices(threat('nginx', 'nginx critical'), devices, services)
    const matching = result.filter(d => d.ip === '192.168.1.5')
    expect(matching).toHaveLength(1)
  })
})

// ── Device hostname matching ──────────────────────────────────────────────────

describe('matchDevices() — device hostname/label match', () => {
  it('matches device by hostname token', () => {
    const devices = [device('10.0.0.5', 'apache-server')]
    const result  = matchDevices(threat('apache', 'Apache HTTP Server RCE'), devices, [])
    expect(result.some(d => d.ip === '10.0.0.5')).toBe(true)
  })

  it('matches device by label token', () => {
    const devices = [{ ip: '10.0.0.6', hostname: '', label: 'mysql-primary', status: 'online' }]
    const result  = matchDevices(threat('mysql', 'MySQL auth bypass'), devices, [])
    expect(result.some(d => d.ip === '10.0.0.6')).toBe(true)
  })

  it('does not match device whose tokens do not overlap', () => {
    const devices = [device('10.0.0.7', 'raspberry-pi')]
    const result  = matchDevices(threat('nginx', 'Nginx directory traversal'), devices, [])
    expect(result).toHaveLength(0)
  })

  it('returns the full device object (not just IP)', () => {
    const dev     = device('10.0.0.8', 'openssh')
    const result  = matchDevices(threat('openssh', 'OpenSSH integer overflow'), [dev], [])
    expect(result[0]).toMatchObject({ ip: '10.0.0.8', hostname: 'openssh' })
  })

  it('matches multiple devices when several are relevant', () => {
    const devices = [
      device('10.0.0.1', 'nginx-front'),
      device('10.0.0.2', 'nginx-back'),
      device('10.0.0.3', 'apache'),
    ]
    const result = matchDevices(threat('nginx', 'Nginx heap use-after-free'), devices, [])
    const ips    = result.map(d => d.ip)
    expect(ips).toContain('10.0.0.1')
    expect(ips).toContain('10.0.0.2')
    expect(ips).not.toContain('10.0.0.3')
  })
})

// ── Token length / stop word filtering ───────────────────────────────────────

describe('matchDevices() — token filtering edge cases', () => {
  it('ignores words ≤3 characters in package name', () => {
    // "ssh" is 3 chars — should be filtered
    const devices = [device('10.0.0.1', 'ssh-server')]
    const result  = matchDevices(threat('ssh', 'ssh issue'), devices, [])
    // "ssh" has exactly 3 chars — filtered (> 3, so 4+ required)
    expect(result).toHaveLength(0)
  })

  it('matches words ≥4 characters (boundary check)', () => {
    // "sshd" is 4 chars — should NOT be filtered
    const devices = [device('10.0.0.1', 'sshd')]
    const result  = matchDevices(threat('sshd', 'sshd authentication bypass'), devices, [])
    expect(result.some(d => d.ip === '10.0.0.1')).toBe(true)
  })

  it('stop word "server" is filtered from both sides', () => {
    const devices = [device('10.0.0.1', 'server')]  // label token 'server' is a stop word
    const result  = matchDevices(threat('server', 'server vulnerability'), devices, [])
    expect(result).toHaveLength(0)
  })
})

// ── deviceThreatLevel() ───────────────────────────────────────────────────────

describe('deviceThreatLevel()', () => {
  const devices = [device('10.0.0.1', 'nginx')]

  it('returns null when no threats', () => {
    expect(deviceThreatLevel('10.0.0.1', [], devices)).toBeNull()
  })

  it('returns null when no threat matches the device', () => {
    const threats = [threat('apache', 'Apache CVE', 'critical')]
    expect(deviceThreatLevel('10.0.0.1', threats, devices)).toBeNull()
  })

  it('returns severity when a threat matches', () => {
    const threats = [threat('nginx', 'Nginx heap overflow', 'high')]
    expect(deviceThreatLevel('10.0.0.1', threats, devices)).toBe('high')
  })

  it('returns worst severity when multiple threats match', () => {
    const threats = [
      threat('nginx', 'Nginx issue one', 'low'),
      threat('nginx', 'Nginx critical path traversal', 'critical'),
      threat('nginx', 'Nginx medium vuln', 'medium'),
    ]
    expect(deviceThreatLevel('10.0.0.1', threats, devices)).toBe('critical')
  })

  it('returns null for a device IP with no matching threats', () => {
    const threats = [threat('nginx', 'Nginx exploit', 'high')]
    expect(deviceThreatLevel('10.0.0.99', threats, devices)).toBeNull()
  })

  it('skips threats already below worst found severity', () => {
    // critical found first — low should be skipped without running matchDevices
    const threats = [
      threat('nginx', 'Nginx critical issue', 'critical'),
      threat('nginx', 'Nginx low issue',      'low'),
    ]
    expect(deviceThreatLevel('10.0.0.1', threats, devices)).toBe('critical')
  })
})
