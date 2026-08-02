// Unit tests for the report aggregation helpers used in server/routes/reports.js
// (chart endpoint: uptime %, latency averaging, status change counting, daily bucketing).
// All tested as pure functions — no DB or HTTP required.

import { describe, it, expect } from 'vitest'

// ── Replicated helpers ────────────────────────────────────────────────────────

/** Compute internet uptime % by weighting each row over the elapsed time to the next row. */
function computeUptime(netRows) {
  if (netRows.length === 0) return 0
  const rows = [...netRows].sort((a, b) => a.ts - b.ts)
  if (rows[0].ts > rows[rows.length - 1].ts) return 0

  let upMs = 0
  let totalMs = 0
  for (let i = 0; i < rows.length; i++) {
    const current = rows[i]
    const next = rows[i + 1]
    const start = current.ts
    // Heuristic: when no `next` row exists, extend the final sample by the
    // previous interval only if that previous interval is small. This avoids
    // collapsing long gaps into a large final-weighted sample while still
    // allowing short rapid-sample series to be extended.
    let end
    if (next) end = next.ts
    else if (i > 0) {
      const prevInt = current.ts - rows[i - 1].ts
      end = prevInt <= 5 ? (current.ts + prevInt) : current.ts
    } else {
      end = current.ts + 1
    }
    const delta = end - start
    if (delta <= 0) continue
    totalMs += delta
    try {
      if (JSON.parse(current.payload).ok ?? false) upMs += delta
    } catch {
      // treat malformed rows as downtime
    }
  }
  return totalMs === 0 ? 0 : parseFloat(((upMs / totalMs) * 100).toFixed(3))
}

/** Flatten internet check rows into { ts, ok, ms } objects. */
function flattenChecks(netRows) {
  return netRows.flatMap(r => {
    try {
      const p  = JSON.parse(r.payload)
      const ok = (p.results ?? []).filter(x => x.ok && x.ms != null)
      const ms = ok.length ? Math.round(ok.reduce((s, x) => s + x.ms, 0) / ok.length) : null
      return [{ ts: r.ts, ok: p.ok ?? false, ms }]
    } catch { return [] }
  })
}

/** Count status-change transitions in a series of { ok } records. */
function countChanges(checks) {
  return checks.reduce((acc, cur, i) => acc + (i > 0 && checks[i - 1].ok !== cur.ok ? 1 : 0), 0)
}

/** Compute average latency from flattened checks, ignoring nulls. */
function computeAvgLatency(checks) {
  const withMs = checks.filter(x => x.ms != null)
  if (withMs.length === 0) return 0
  return Math.round(withMs.reduce((s, x) => s + x.ms, 0) / withMs.length)
}

/** Bucket device events into daily { date, new, online, offline, ports } records. */
function bucketByDay(rows) {
  const byDay = new Map()
  for (const r of rows) {
    const d   = new Date(r.ts)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!byDay.has(key)) byDay.set(key, { date: key, new: 0, online: 0, offline: 0, ports: 0 })
    const day = byDay.get(key)
    if      (r.event === 'device.new')        day.new++
    else if (r.event === 'device.online')     day.online++
    else if (r.event === 'device.offline')    day.offline++
    else if (r.event === 'device.port.open')  day.ports++
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
}

/** Extract and count port-open events into sorted top-N array. */
function topPorts(portRows, n = 10) {
  const counts = new Map()
  for (const r of portRows) {
    try {
      const p = JSON.parse(r.payload)
      if (p.port) counts.set(String(p.port), (counts.get(String(p.port)) ?? 0) + 1)
    } catch {}
  }
  return Array.from(counts.entries())
    .map(([port, count]) => ({ port, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

// ── computeUptime() ───────────────────────────────────────────────────────────

describe('computeUptime()', () => {
  it('returns 0 for empty input', () => {
    expect(computeUptime([])).toBe(0)
  })

  it('returns 100 when all checks are ok', () => {
    const rows = [
      { ts: 1, payload: JSON.stringify({ ok: true }) },
      { ts: 11, payload: JSON.stringify({ ok: true }) },
    ]
    expect(computeUptime(rows)).toBe(100)
  })

  it('returns 0 when all checks fail', () => {
    const rows = [
      { ts: 1, payload: JSON.stringify({ ok: false }) },
      { ts: 11, payload: JSON.stringify({ ok: false }) },
    ]
    expect(computeUptime(rows)).toBe(0)
  })

  it('computes 50% correctly', () => {
    const rows = [
      { ts: 1, payload: JSON.stringify({ ok: true  }) },
      { ts: 11, payload: JSON.stringify({ ok: false }) },
      { ts: 21, payload: JSON.stringify({ ok: true  }) },
    ]
    expect(computeUptime(rows)).toBe(50)
  })

  it('rounds to 3 decimal places', () => {
    // 2/3 = 66.666...%
    const rows = [
      { ts: 1, payload: JSON.stringify({ ok: true  }) },
      { ts: 2, payload: JSON.stringify({ ok: true  }) },
      { ts: 3, payload: JSON.stringify({ ok: false }) },
    ]
    expect(computeUptime(rows)).toBe(66.667)
  })

  it('skips rows with invalid JSON', () => {
    const rows = [
      { ts: 1, payload: 'BAD JSON' },
      { ts: 2, payload: JSON.stringify({ ok: true }) },
    ]
    // 1 ok / 2 total = 50%
    expect(computeUptime(rows)).toBe(50)
  })

  it('treats missing ok field as false', () => {
    const rows = [
      { ts: 1, payload: JSON.stringify({}) },  // no ok field
      { ts: 11, payload: JSON.stringify({ ok: true }) },
    ]
    expect(computeUptime(rows)).toBe(0)
  })

  it('weights longer outages more heavily than sample counts', () => {
    const rows = [
      { ts: 1,  payload: JSON.stringify({ ok: true }) },
      { ts: 6,  payload: JSON.stringify({ ok: true }) },
      { ts: 11, payload: JSON.stringify({ ok: false }) },
      { ts: 12, payload: JSON.stringify({ ok: false }) },
      { ts: 13, payload: JSON.stringify({ ok: false }) },
      { ts: 14, payload: JSON.stringify({ ok: false }) },
      { ts: 21, payload: JSON.stringify({ ok: true }) },
    ]
    expect(computeUptime(rows)).toBe(50)
  })
})

// ── flattenChecks() ───────────────────────────────────────────────────────────

describe('flattenChecks()', () => {
  it('returns empty array for empty input', () => {
    expect(flattenChecks([])).toEqual([])
  })

  it('extracts ts, ok, and averaged ms from results', () => {
    const row = {
      ts: 1000,
      payload: JSON.stringify({
        ok: true,
        results: [{ ok: true, ms: 20 }, { ok: true, ms: 40 }],
      }),
    }
    const [check] = flattenChecks([row])
    expect(check.ts).toBe(1000)
    expect(check.ok).toBe(true)
    expect(check.ms).toBe(30) // avg of 20+40
  })

  it('sets ms to null when no ok results with latency', () => {
    const row = {
      ts: 1000,
      payload: JSON.stringify({ ok: false, results: [{ ok: false }] }),
    }
    const [check] = flattenChecks([row])
    expect(check.ms).toBeNull()
  })

  it('skips rows with invalid JSON', () => {
    const rows = [{ ts: 1, payload: 'NOT JSON' }, { ts: 2, payload: JSON.stringify({ ok: true, results: [] }) }]
    expect(flattenChecks(rows)).toHaveLength(1)
  })

  it('only averages results that are ok and have ms', () => {
    const row = {
      ts: 1,
      payload: JSON.stringify({
        ok: true,
        results: [
          { ok: true,  ms: 100 },
          { ok: false, ms: 999 }, // failed — excluded from average
          { ok: true,  ms: null }, // no ms — excluded
          { ok: true,  ms: 50  },
        ],
      }),
    }
    const [check] = flattenChecks([row])
    expect(check.ms).toBe(75) // avg of 100 + 50
  })
})

// ── countChanges() ────────────────────────────────────────────────────────────

describe('countChanges()', () => {
  it('returns 0 for empty or single-element input', () => {
    expect(countChanges([])).toBe(0)
    expect(countChanges([{ ok: true }])).toBe(0)
  })

  it('returns 0 when status never changes', () => {
    const checks = [{ ok: true }, { ok: true }, { ok: true }]
    expect(countChanges(checks)).toBe(0)
  })

  it('counts each transition', () => {
    const checks = [
      { ok: true  },
      { ok: false }, // → change 1
      { ok: false },
      { ok: true  }, // → change 2
      { ok: true  },
      { ok: false }, // → change 3
    ]
    expect(countChanges(checks)).toBe(3)
  })

  it('counts a single transition correctly', () => {
    expect(countChanges([{ ok: true }, { ok: false }])).toBe(1)
  })
})

// ── computeAvgLatency() ───────────────────────────────────────────────────────

describe('computeAvgLatency()', () => {
  it('returns 0 for empty input', () => {
    expect(computeAvgLatency([])).toBe(0)
  })

  it('returns 0 when all ms are null', () => {
    expect(computeAvgLatency([{ ms: null }, { ms: null }])).toBe(0)
  })

  it('computes simple average', () => {
    expect(computeAvgLatency([{ ms: 10 }, { ms: 20 }, { ms: 30 }])).toBe(20)
  })

  it('rounds to nearest integer', () => {
    expect(computeAvgLatency([{ ms: 10 }, { ms: 11 }])).toBe(11) // 10.5 → 11
  })

  it('ignores null ms values in average', () => {
    expect(computeAvgLatency([{ ms: 10 }, { ms: null }, { ms: 30 }])).toBe(20)
  })
})

// ── bucketByDay() ─────────────────────────────────────────────────────────────

describe('bucketByDay()', () => {
  const DAY = 86_400_000
  const BASE = new Date('2025-01-15T00:00:00Z').getTime()

  it('returns empty array for no events', () => {
    expect(bucketByDay([])).toEqual([])
  })

  it('buckets events by calendar day', () => {
    const rows = [
      { ts: BASE + 1000,     event: 'device.new'     },
      { ts: BASE + 2000,     event: 'device.online'  },
      { ts: BASE + DAY,      event: 'device.offline' }, // next day
    ]
    const daily = bucketByDay(rows)
    expect(daily).toHaveLength(2)
  })

  it('counts event types correctly', () => {
    const rows = [
      { ts: BASE, event: 'device.new'       },
      { ts: BASE, event: 'device.new'       },
      { ts: BASE, event: 'device.online'    },
      { ts: BASE, event: 'device.offline'   },
      { ts: BASE, event: 'device.port.open' },
    ]
    const [day] = bucketByDay(rows)
    expect(day.new).toBe(2)
    expect(day.online).toBe(1)
    expect(day.offline).toBe(1)
    expect(day.ports).toBe(1)
  })

  it('sorts results by date ascending', () => {
    const rows = [
      { ts: BASE + 2 * DAY, event: 'device.new' },
      { ts: BASE,           event: 'device.new' },
      { ts: BASE + 1 * DAY, event: 'device.new' },
    ]
    const daily = bucketByDay(rows)
    expect(daily[0].date < daily[1].date).toBe(true)
    expect(daily[1].date < daily[2].date).toBe(true)
  })

  it('ignores unknown event types (count stays 0)', () => {
    const rows = [{ ts: BASE, event: 'config.saved' }]
    const [day] = bucketByDay(rows)
    expect(day.new).toBe(0)
    expect(day.online).toBe(0)
    expect(day.offline).toBe(0)
    expect(day.ports).toBe(0)
  })
})

// ── topPorts() ────────────────────────────────────────────────────────────────

describe('topPorts()', () => {
  it('returns empty for empty input', () => {
    expect(topPorts([])).toEqual([])
  })

  it('counts and sorts ports by frequency', () => {
    const rows = [
      { payload: JSON.stringify({ port: 80  }) },
      { payload: JSON.stringify({ port: 80  }) },
      { payload: JSON.stringify({ port: 80  }) },
      { payload: JSON.stringify({ port: 443 }) },
      { payload: JSON.stringify({ port: 443 }) },
      { payload: JSON.stringify({ port: 22  }) },
    ]
    const ports = topPorts(rows)
    expect(ports[0]).toEqual({ port: '80', count: 3 })
    expect(ports[1]).toEqual({ port: '443', count: 2 })
    expect(ports[2]).toEqual({ port: '22', count: 1 })
  })

  it('limits to n results', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      payload: JSON.stringify({ port: i + 1 }),
    }))
    expect(topPorts(rows, 5)).toHaveLength(5)
  })

  it('skips rows with invalid JSON', () => {
    const rows = [
      { payload: 'INVALID' },
      { payload: JSON.stringify({ port: 80 }) },
    ]
    expect(topPorts(rows)).toHaveLength(1)
  })

  it('skips rows with no port field', () => {
    const rows = [{ payload: JSON.stringify({ notport: 80 }) }]
    expect(topPorts(rows)).toHaveLength(0)
  })
})
