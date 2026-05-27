// Unit tests for the internet outage pairing algorithm in server/routes/reports.js.
// The algorithm pairs internet.down / internet.up audit events into outage periods
// and computes uptimeBeforeMs (how long the connection was up before each outage).
//
// Tested as a pure function to avoid any DB or Express dependencies.

import { describe, it, expect } from 'vitest'

// ── Replicated from server/routes/reports.js (GET /api/reports/outages) ──────

/**
 * Pairs down/up events into outage objects.
 * @param {{ ts: number, event: 'internet.down' | 'internet.up' }[]} events - sorted ASC
 * @param {number} [nowMs] - current timestamp (defaults to Date.now())
 * @returns {{ start, end, durationMs, uptimeBeforeMs, ongoing }[]}
 */
function pairOutages(events, nowMs = Date.now()) {
  const outages = []
  let downTs   = null
  let lastUpTs = null

  for (const e of events) {
    if (e.event === 'internet.down' && downTs === null) {
      downTs = e.ts
    } else if (e.event === 'internet.up' && downTs !== null) {
      const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
      outages.push({ start: downTs, end: e.ts, durationMs: e.ts - downTs, uptimeBeforeMs, ongoing: false })
      lastUpTs = e.ts
      downTs   = null
    } else if (e.event === 'internet.up') {
      lastUpTs = e.ts
    }
  }

  if (downTs !== null) {
    const uptimeBeforeMs = lastUpTs !== null ? downTs - lastUpTs : null
    outages.push({ start: downTs, end: null, durationMs: nowMs - downTs, uptimeBeforeMs, ongoing: true })
  }

  return outages
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const T = (offset = 0) => 1_700_000_000_000 + offset
const MIN = 60_000
const HR  = 60 * MIN

// ── No events ─────────────────────────────────────────────────────────────────

describe('pairOutages() — empty input', () => {
  it('returns empty array for no events', () => {
    expect(pairOutages([])).toEqual([])
  })

  it('returns empty array when only internet.up events exist', () => {
    expect(pairOutages([{ ts: T(), event: 'internet.up' }])).toEqual([])
  })
})

// ── Single outage ─────────────────────────────────────────────────────────────

describe('pairOutages() — single resolved outage', () => {
  const events = [
    { ts: T(0),        event: 'internet.down' },
    { ts: T(5 * MIN),  event: 'internet.up'   },
  ]
  const outages = pairOutages(events)

  it('produces exactly one outage', () => {
    expect(outages).toHaveLength(1)
  })

  it('sets correct start and end timestamps', () => {
    expect(outages[0].start).toBe(T(0))
    expect(outages[0].end).toBe(T(5 * MIN))
  })

  it('computes correct durationMs', () => {
    expect(outages[0].durationMs).toBe(5 * MIN)
  })

  it('marks as not ongoing', () => {
    expect(outages[0].ongoing).toBe(false)
  })

  it('sets uptimeBeforeMs to null (no prior up event)', () => {
    expect(outages[0].uptimeBeforeMs).toBeNull()
  })
})

// ── Ongoing outage ────────────────────────────────────────────────────────────

describe('pairOutages() — ongoing outage', () => {
  const downTs = T(0)
  const nowMs  = T(10 * MIN)
  const events = [{ ts: downTs, event: 'internet.down' }]
  const outages = pairOutages(events, nowMs)

  it('marks as ongoing', () => {
    expect(outages[0].ongoing).toBe(true)
  })

  it('end is null', () => {
    expect(outages[0].end).toBeNull()
  })

  it('durationMs is measured from down to now', () => {
    expect(outages[0].durationMs).toBe(10 * MIN)
  })
})

// ── Multiple outages ──────────────────────────────────────────────────────────

describe('pairOutages() — multiple outages', () => {
  // Connection was up for 2h, then down 5m, up 1h, then down 3m, up
  const events = [
    { ts: T(0),           event: 'internet.up'   }, // initial up
    { ts: T(2 * HR),      event: 'internet.down' }, // first outage starts
    { ts: T(2*HR + 5*MIN),event: 'internet.up'   }, // first outage ends (5m)
    { ts: T(3*HR + 5*MIN),event: 'internet.down' }, // second outage starts (1h later)
    { ts: T(3*HR + 8*MIN),event: 'internet.up'   }, // second outage ends (3m)
  ]
  const outages = pairOutages(events)

  it('produces two outages', () => {
    expect(outages).toHaveLength(2)
  })

  it('first outage: correct duration (5 min)', () => {
    expect(outages[0].durationMs).toBe(5 * MIN)
  })

  it('first outage: uptimeBeforeMs is null (first down after initial up without prior down)', () => {
    // The initial up at T(0) is tracked as lastUpTs.
    // First down at T(2*HR). uptimeBeforeMs = T(2*HR) - T(0) = 2h
    expect(outages[0].uptimeBeforeMs).toBe(2 * HR)
  })

  it('second outage: correct duration (3 min)', () => {
    expect(outages[1].durationMs).toBe(3 * MIN)
  })

  it('second outage: uptimeBeforeMs is 1h (from end of first outage to start of second)', () => {
    // lastUpTs after first outage = T(2*HR + 5*MIN)
    // second down at T(3*HR + 5*MIN)
    // uptimeBeforeMs = T(3*HR+5*MIN) - T(2*HR+5*MIN) = 1h
    expect(outages[1].uptimeBeforeMs).toBe(1 * HR)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('pairOutages() — edge cases', () => {
  it('ignores duplicate down events (second down before any up)', () => {
    const events = [
      { ts: T(0),     event: 'internet.down' },
      { ts: T(1*MIN), event: 'internet.down' }, // duplicate — ignored
      { ts: T(5*MIN), event: 'internet.up'   },
    ]
    const outages = pairOutages(events)
    expect(outages).toHaveLength(1)
    expect(outages[0].start).toBe(T(0))  // paired with first down
    expect(outages[0].durationMs).toBe(5 * MIN)
  })

  it('ignores up event with no preceding down', () => {
    const events = [
      { ts: T(0),     event: 'internet.up' },   // no paired down
      { ts: T(1*MIN), event: 'internet.up' },   // no paired down
    ]
    expect(pairOutages(events)).toEqual([])
  })

  it('handles single ongoing event correctly', () => {
    const nowMs  = T(30 * MIN)
    const events = [{ ts: T(0), event: 'internet.down' }]
    const [o] = pairOutages(events, nowMs)
    expect(o.ongoing).toBe(true)
    expect(o.durationMs).toBe(30 * MIN)
    expect(o.uptimeBeforeMs).toBeNull()
  })

  it('ongoing outage after previous resolved outage has uptimeBeforeMs set', () => {
    const events = [
      { ts: T(0),      event: 'internet.down' },
      { ts: T(5*MIN),  event: 'internet.up'   },
      { ts: T(2*HR),   event: 'internet.down' }, // second outage, still ongoing
    ]
    const nowMs  = T(2*HR + 10*MIN)
    const outages = pairOutages(events, nowMs)
    expect(outages).toHaveLength(2)
    const ongoing = outages[1]
    expect(ongoing.ongoing).toBe(true)
    expect(ongoing.uptimeBeforeMs).toBe(T(2*HR) - T(5*MIN))
  })

  it('very short outage (< 1 second)', () => {
    const events = [
      { ts: T(0),   event: 'internet.down' },
      { ts: T(500), event: 'internet.up'   }, // 500ms
    ]
    const [o] = pairOutages(events)
    expect(o.durationMs).toBe(500)
    expect(o.ongoing).toBe(false)
  })

  it('events already sorted ASC are processed in order', () => {
    const events = [
      { ts: T(0),     event: 'internet.down' },
      { ts: T(5*MIN), event: 'internet.up'   },
      { ts: T(1*HR),  event: 'internet.down' },
      { ts: T(1*HR + 2*MIN), event: 'internet.up' },
    ]
    const outages = pairOutages(events)
    expect(outages[0].durationMs).toBe(5 * MIN)
    expect(outages[1].durationMs).toBe(2 * MIN)
  })
})

// ── Window filtering (replicated from route) ──────────────────────────────────

describe('windowed filtering', () => {
  function filterWindow(outages, from, to) {
    return outages.filter(o => (!o.end || o.end >= from) && o.start <= to)
  }

  it('includes outage fully within window', () => {
    const outages = [{ start: T(1*HR), end: T(2*HR), durationMs: 1*HR, ongoing: false, uptimeBeforeMs: null }]
    expect(filterWindow(outages, T(0), T(3*HR))).toHaveLength(1)
  })

  it('excludes outage entirely before window', () => {
    const outages = [{ start: T(0), end: T(30*MIN), durationMs: 30*MIN, ongoing: false, uptimeBeforeMs: null }]
    expect(filterWindow(outages, T(1*HR), T(2*HR))).toHaveLength(0)
  })

  it('includes outage that overlaps window start', () => {
    const outages = [{ start: T(0), end: T(2*HR), durationMs: 2*HR, ongoing: false, uptimeBeforeMs: null }]
    expect(filterWindow(outages, T(1*HR), T(3*HR))).toHaveLength(1)
  })

  it('includes ongoing outage that started before window', () => {
    const outages = [{ start: T(0), end: null, durationMs: 5*HR, ongoing: true, uptimeBeforeMs: null }]
    expect(filterWindow(outages, T(1*HR), T(3*HR))).toHaveLength(1)
  })

  it('excludes outage that starts after window end', () => {
    const outages = [{ start: T(5*HR), end: T(6*HR), durationMs: 1*HR, ongoing: false, uptimeBeforeMs: null }]
    expect(filterWindow(outages, T(0), T(3*HR))).toHaveLength(0)
  })
})
