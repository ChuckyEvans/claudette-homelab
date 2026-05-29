// Unit tests for the sanitization and validation logic in server/routes/config.js.
// These rules guard every config save — OWASP A03 (Injection) and A05 (Misconfiguration).
// The logic is replicated here as pure functions to test without Express/FS/DB deps.

import { describe, it, expect } from 'vitest'

// ── Replicated helpers (must stay in sync with server/routes/config.js) ──────

const sanitize = (v, re, max) => String(v ?? '').replace(re, '').slice(0, max)

const VALID_THEMES = [
  'starfield','dark','nebula','aurora','synthwave','ocean','forest',
  'volcanic','arctic','matrix','crimson','cobalt','amber','crystal','circuit','storm',
]

const VALID_RETENTION_DAYS = [30, 60, 90, 180, 365]

function buildSchedule(body) {
  const intOrDef = (v, def) => { const n = parseInt(v); return Number.isFinite(n) ? n : def }
  return {
    check_interval_minutes:       Math.max(1, intOrDef(body.schedule?.check_interval_minutes, 5)),
    internet_check_minutes:       Math.max(1, intOrDef(body.schedule?.internet_check_minutes, 5)),
    threat_interval_hours:        Math.max(1, intOrDef(body.schedule?.threat_interval_hours,  6)),
    ping_interval_minutes:        Math.max(1, intOrDef(body.schedule?.ping_interval_minutes,  5)),
    deep_scan_hour:               Math.min(23, Math.max(0, intOrDef(body.schedule?.deep_scan_hour, 4))),
    speedtest_interval_hours:     Math.max(1, intOrDef(body.schedule?.speedtest_interval_hours, 1)),
    internet_outage_check_seconds: Math.max(5, Math.min(300, intOrDef(body.schedule?.internet_outage_check_seconds, 10))),
  }
}

function buildIsp(body, existing = {}) {
  return {
    name:               String(body.isp?.name               ?? existing.name               ?? '').slice(0, 128),
    connection_type:    String(body.isp?.connection_type     ?? existing.connection_type    ?? 'broadband').slice(0, 32),
    expected_uptime:    parseFloat(body.isp?.expected_uptime ?? existing.expected_uptime    ?? 100) || 100,
    plan_download_mbps: parseFloat(body.isp?.plan_download_mbps ?? existing.plan_download_mbps ?? 0) || 0,
    plan_upload_mbps:   parseFloat(body.isp?.plan_upload_mbps   ?? existing.plan_upload_mbps   ?? 0) || 0,
    account_number:     String(body.isp?.account_number     ?? existing.account_number     ?? '').slice(0, 64),
    support_email:      String(body.isp?.support_email      ?? existing.support_email      ?? '').slice(0, 128),
  }
}

function resolveTheme(body, existing = {}) {
  return VALID_THEMES.includes(body.ui?.theme)
    ? body.ui.theme
    : (existing.theme ?? 'starfield')
}

function resolveRetention(body, existing = {}) {
  const days = parseInt(body.retention?.days)
  return VALID_RETENTION_DAYS.includes(days) ? days : (existing.days ?? 90)
}

function sanitizeServices(services) {
  if (!Array.isArray(services)) return []
  return services.map(s => ({
    name: sanitize(s.name ?? '', /[^a-zA-Z0-9 _.:-]/g, 64),
    type: ['http', 'docker'].includes(s.type) ? s.type : 'http',
    url:  String(s.url ?? '').slice(0, 256),
    ...(s.expect_status ? { expect_status: parseInt(s.expect_status) || 200 } : {}),
  })).filter(s => s.name && s.url)
}

// ── sanitize() ────────────────────────────────────────────────────────────────

describe('sanitize()', () => {
  it('strips disallowed characters from pi host', () => {
    expect(sanitize('192.168.1.10', /[^0-9.]/g, 15)).toBe('192.168.1.10')
    expect(sanitize('192.168.1.10; rm -rf /', /[^0-9.]/g, 15)).toBe('192.168.1.10')
    // Digits in the injection payload survive the strip — result is truncated to 15 chars
    expect(sanitize("192.168.1.1' OR '1'='1", /[^0-9.]/g, 15)).toBe('192.168.1.111')
  })
  it('truncates to max length', () => {
    expect(sanitize('a'.repeat(20), /[^a-z]/g, 10)).toHaveLength(10)
  })
  it('handles null/undefined gracefully', () => {
    expect(sanitize(null,      /[^a-z]/g, 10)).toBe('')
    expect(sanitize(undefined, /[^a-z]/g, 10)).toBe('')
  })
  it('strips injection characters from ssh_user', () => {
    // Spaces, semicolons, dots are stripped; alphanumeric chars remain concatenated
    expect(sanitize('ubuntu; curl evil.com', /[^a-zA-Z0-9_-]/g, 32)).toBe('ubuntucurlevilcom')
    expect(sanitize('$(whoami)', /[^a-zA-Z0-9_-]/g, 32)).toBe('whoami')
  })
  it('strips shell metacharacters from subnets', () => {
    // The trailing / in "rm -rf /" is kept because / is an allowed CIDR char
    expect(sanitize('192.168.8.0/24`rm -rf /`', /[^0-9./]/g, 20)).toBe('192.168.8.0/24/')
  })
})

// ── buildSchedule() ───────────────────────────────────────────────────────────

describe('buildSchedule()', () => {
  it('uses defaults when body is empty', () => {
    const s = buildSchedule({})
    expect(s.check_interval_minutes).toBe(5)
    expect(s.internet_check_minutes).toBe(5)
    expect(s.threat_interval_hours).toBe(6)
    expect(s.ping_interval_minutes).toBe(5)
    expect(s.deep_scan_hour).toBe(4)
    expect(s.speedtest_interval_hours).toBe(1)
  })

  it('accepts valid values', () => {
    const s = buildSchedule({ schedule: {
      check_interval_minutes: 10,
      internet_check_minutes: 3,
      threat_interval_hours: 12,
      ping_interval_minutes: 2,
      deep_scan_hour: 3,
      speedtest_interval_hours: 6,
    }})
    expect(s.check_interval_minutes).toBe(10)
    expect(s.internet_check_minutes).toBe(3)
    expect(s.threat_interval_hours).toBe(12)
    expect(s.ping_interval_minutes).toBe(2)
    expect(s.deep_scan_hour).toBe(3)
    expect(s.speedtest_interval_hours).toBe(6)
  })

  it('clamps check_interval_minutes to minimum 1', () => {
    expect(buildSchedule({ schedule: { check_interval_minutes: 0 }  }).check_interval_minutes).toBe(1)
    expect(buildSchedule({ schedule: { check_interval_minutes: -5 } }).check_interval_minutes).toBe(1)
  })

  it('clamps deep_scan_hour between 0 and 23', () => {
    expect(buildSchedule({ schedule: { deep_scan_hour: -1  } }).deep_scan_hour).toBe(0)
    expect(buildSchedule({ schedule: { deep_scan_hour: 24  } }).deep_scan_hour).toBe(23)
    expect(buildSchedule({ schedule: { deep_scan_hour: 100 } }).deep_scan_hour).toBe(23)
    expect(buildSchedule({ schedule: { deep_scan_hour: 0   } }).deep_scan_hour).toBe(0)
    expect(buildSchedule({ schedule: { deep_scan_hour: 23  } }).deep_scan_hour).toBe(23)
  })

  it('falls back to default when value is NaN', () => {
    expect(buildSchedule({ schedule: { check_interval_minutes: 'abc' } }).check_interval_minutes).toBe(5)
    expect(buildSchedule({ schedule: { speedtest_interval_hours: null } }).speedtest_interval_hours).toBe(1)
  })

  it('internet_outage_check_seconds defaults to 10', () => {
    expect(buildSchedule({}).internet_outage_check_seconds).toBe(10)
  })

  it('internet_outage_check_seconds clamps to minimum 5', () => {
    expect(buildSchedule({ schedule: { internet_outage_check_seconds: 1   } }).internet_outage_check_seconds).toBe(5)
    expect(buildSchedule({ schedule: { internet_outage_check_seconds: -10 } }).internet_outage_check_seconds).toBe(5)
  })

  it('internet_outage_check_seconds clamps to maximum 300', () => {
    expect(buildSchedule({ schedule: { internet_outage_check_seconds: 999 } }).internet_outage_check_seconds).toBe(300)
  })

  it('internet_outage_check_seconds falls back to 10 on NaN', () => {
    expect(buildSchedule({ schedule: { internet_outage_check_seconds: 'bad' } }).internet_outage_check_seconds).toBe(10)
  })

  it('internet_outage_check_seconds accepts valid in-range value', () => {
    expect(buildSchedule({ schedule: { internet_outage_check_seconds: 30 } }).internet_outage_check_seconds).toBe(30)
  })
})

// ── buildIsp() ────────────────────────────────────────────────────────────────

describe('buildIsp()', () => {
  it('returns defaults when body.isp is missing', () => {
    const isp = buildIsp({})
    expect(isp.name).toBe('')
    expect(isp.connection_type).toBe('broadband')
    expect(isp.expected_uptime).toBe(100)
    expect(isp.plan_download_mbps).toBe(0)
    expect(isp.plan_upload_mbps).toBe(0)
    expect(isp.account_number).toBe('')
    expect(isp.support_email).toBe('')
  })

  it('persists existing values when body.isp is missing', () => {
    const existing = { name: 'MetroFibre', expected_uptime: 99, plan_download_mbps: 250, plan_upload_mbps: 250 }
    const isp = buildIsp({}, existing)
    expect(isp.name).toBe('MetroFibre')
    expect(isp.expected_uptime).toBe(99)
    expect(isp.plan_download_mbps).toBe(250)
    expect(isp.plan_upload_mbps).toBe(250)
  })

  it('accepts all valid fields', () => {
    const isp = buildIsp({ isp: {
      name: 'MetroFibre', connection_type: 'fibre', expected_uptime: 100,
      plan_download_mbps: 250, plan_upload_mbps: 250,
      account_number: 'ACC-001', support_email: 'support@metrofibre.co.za',
    }})
    expect(isp.name).toBe('MetroFibre')
    expect(isp.connection_type).toBe('fibre')
    expect(isp.expected_uptime).toBe(100)
    expect(isp.plan_download_mbps).toBe(250)
    expect(isp.plan_upload_mbps).toBe(250)
    expect(isp.account_number).toBe('ACC-001')
    expect(isp.support_email).toBe('support@metrofibre.co.za')
  })

  it('truncates name to 128 chars', () => {
    expect(buildIsp({ isp: { name: 'x'.repeat(200) } }).name).toHaveLength(128)
  })

  it('truncates support_email to 128 chars', () => {
    expect(buildIsp({ isp: { support_email: 'a'.repeat(200) } }).support_email).toHaveLength(128)
  })

  it('falls back expected_uptime to 100 when invalid', () => {
    expect(buildIsp({ isp: { expected_uptime: 'bad' } }).expected_uptime).toBe(100)
    expect(buildIsp({ isp: { expected_uptime: 0     } }).expected_uptime).toBe(100) // falsy → fallback
  })

  it('falls back plan speeds to 0 when invalid', () => {
    expect(buildIsp({ isp: { plan_download_mbps: 'bad' } }).plan_download_mbps).toBe(0)
    expect(buildIsp({ isp: { plan_upload_mbps: null    } }).plan_upload_mbps).toBe(0)
  })
})

// ── resolveTheme() ────────────────────────────────────────────────────────────

describe('resolveTheme()', () => {
  it('accepts all valid theme IDs', () => {
    for (const id of VALID_THEMES) {
      expect(resolveTheme({ ui: { theme: id } })).toBe(id)
    }
  })

  it('includes storm (regression: previously missing from server list)', () => {
    expect(resolveTheme({ ui: { theme: 'storm' } })).toBe('storm')
  })

  it('falls back to starfield for unknown themes', () => {
    expect(resolveTheme({ ui: { theme: 'rainbow'   } })).toBe('starfield')
    expect(resolveTheme({ ui: { theme: ''          } })).toBe('starfield')
    expect(resolveTheme({ ui: { theme: '<script>'  } })).toBe('starfield')
    expect(resolveTheme({                            })).toBe('starfield')
  })

  it('falls back to existing theme when body has no ui', () => {
    expect(resolveTheme({}, { theme: 'nebula' })).toBe('nebula')
  })

  it('rejects injection attempts', () => {
    expect(resolveTheme({ ui: { theme: "'; DROP TABLE--" } })).toBe('starfield')
  })
})

// ── resolveRetention() ────────────────────────────────────────────────────────

describe('resolveRetention()', () => {
  it('accepts all whitelisted values', () => {
    for (const d of VALID_RETENTION_DAYS) {
      expect(resolveRetention({ retention: { days: d } })).toBe(d)
    }
  })

  it('rejects arbitrary values and uses fallback', () => {
    expect(resolveRetention({ retention: { days: 7    } })).toBe(90)
    expect(resolveRetention({ retention: { days: 1000 } })).toBe(90)
    expect(resolveRetention({ retention: { days: 'all time' } })).toBe(90)
    expect(resolveRetention({                                 })).toBe(90)
  })

  it('uses existing retention when body has no retention', () => {
    expect(resolveRetention({}, { days: 180 })).toBe(180)
  })
})

// ── sanitizeServices() ────────────────────────────────────────────────────────

describe('sanitizeServices()', () => {
  it('normalises a valid HTTP service', () => {
    const svcs = sanitizeServices([{ name: 'Home Router', type: 'http', url: 'http://192.168.8.10/admin', expect_status: 200 }])
    expect(svcs).toHaveLength(1)
    expect(svcs[0].name).toBe('Home Router')
    expect(svcs[0].type).toBe('http')
    expect(svcs[0].expect_status).toBe(200)
  })

  it('normalises a docker service', () => {
    const svcs = sanitizeServices([{ name: 'claudette', type: 'docker', url: 'claudette' }])
    expect(svcs[0].type).toBe('docker')
  })

  it('defaults unknown type to http', () => {
    const svcs = sanitizeServices([{ name: 'test', type: 'ftp', url: 'http://x.com' }])
    expect(svcs[0].type).toBe('http')
  })

  it('strips injection characters from name', () => {
    const svcs = sanitizeServices([{ name: 'bad<>name', type: 'http', url: 'http://x.com' }])
    expect(svcs[0].name).toBe('badname')
  })

  it('truncates name to 64 chars', () => {
    const svcs = sanitizeServices([{ name: 'a'.repeat(100), type: 'http', url: 'http://x.com' }])
    expect(svcs[0].name).toHaveLength(64)
  })

  it('filters out entries without name or url', () => {
    const svcs = sanitizeServices([
      { name: '',    type: 'http', url: 'http://x.com' },
      { name: 'ok',  type: 'http', url: '' },
      { name: 'ok',  type: 'http', url: 'http://x.com' },
    ])
    expect(svcs).toHaveLength(1)
  })

  it('returns empty array for non-array input', () => {
    expect(sanitizeServices(null)).toEqual([])
    expect(sanitizeServices('string')).toEqual([])
    expect(sanitizeServices(undefined)).toEqual([])
  })
})
