// Unit tests for server/utils/schedule.js
// minutesToCron and hoursToCron convert plain interval numbers to cron expressions
// that fire on clock-aligned boundaries rather than relative to server start-up.

import { describe, it, expect } from 'vitest'
import { minutesToCron, hoursToCron } from '../../server/utils/schedule.js'

// ── minutesToCron() ───────────────────────────────────────────────────────────

describe('minutesToCron()', () => {
  it('returns every-minute expression for 1', () => {
    expect(minutesToCron(1)).toBe('* * * * *')
  })

  it('returns every-minute expression for 0 or negative', () => {
    expect(minutesToCron(0)).toBe('* * * * *')
    expect(minutesToCron(-5)).toBe('* * * * *')
  })

  it('returns /N expression for 2–59 minutes', () => {
    expect(minutesToCron(2)).toBe('*/2 * * * *')
    expect(minutesToCron(5)).toBe('*/5 * * * *')
    expect(minutesToCron(15)).toBe('*/15 * * * *')
    expect(minutesToCron(30)).toBe('*/30 * * * *')
    expect(minutesToCron(59)).toBe('*/59 * * * *')
  })

  it('returns top-of-every-hour expression for 60', () => {
    expect(minutesToCron(60)).toBe('0 * * * *')
  })

  it('returns top-of-every-hour expression for values > 60', () => {
    expect(minutesToCron(90)).toBe('0 * * * *')
    expect(minutesToCron(120)).toBe('0 * * * *')
  })
})

// ── hoursToCron() ─────────────────────────────────────────────────────────────

describe('hoursToCron()', () => {
  it('returns top-of-every-hour expression for 1', () => {
    expect(hoursToCron(1)).toBe('0 * * * *')
  })

  it('returns top-of-every-hour expression for 0 or negative', () => {
    expect(hoursToCron(0)).toBe('0 * * * *')
    expect(hoursToCron(-1)).toBe('0 * * * *')
  })

  it('returns /N expression for 2–23 hours', () => {
    expect(hoursToCron(2)).toBe('0 */2 * * *')
    expect(hoursToCron(4)).toBe('0 */4 * * *')
    expect(hoursToCron(6)).toBe('0 */6 * * *')
    expect(hoursToCron(12)).toBe('0 */12 * * *')
    expect(hoursToCron(23)).toBe('0 */23 * * *')
  })

  it('returns midnight-daily expression for 24', () => {
    expect(hoursToCron(24)).toBe('0 0 * * *')
  })

  it('returns midnight-daily expression for values > 24', () => {
    expect(hoursToCron(48)).toBe('0 0 * * *')
    expect(hoursToCron(168)).toBe('0 0 * * *')
  })
})
