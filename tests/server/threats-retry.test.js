import { describe, it, expect, vi } from 'vitest'
import { fetchThreatFeedText, isRetryableThreatFeedError } from '../../server/routes/threats.js'

describe('threat feed retries', () => {
  it('retries transient 502s and eventually returns text', async () => {
    const errors = []
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')) })

    let attempts = 0
    const fetchFn = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) {
        return { ok: false, status: 502, text: async () => '' }
      }
      return { ok: true, status: 200, text: async () => '<feed>ok</feed>' }
    })

    await expect(fetchThreatFeedText('https://example.com/feed', { fetchFn, maxAttempts: 4 })).resolves.toBe('<feed>ok</feed>')
    expect(attempts).toBe(3)
    expect(errors.some(line => line.includes('retryable'))).toBe(true)
  })

  it('does not retry non-retryable 404s', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }))

    await expect(fetchThreatFeedText('https://example.com/feed', { fetchFn, maxAttempts: 4 })).rejects.toThrow('Status code 404')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does not retry 429 rate limits', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => '3600' },
      text: async () => '',
    }))

    await expect(fetchThreatFeedText('https://example.com/feed', { fetchFn, maxAttempts: 4 })).rejects.toThrow('Status code 429')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('treats 502 errors as retryable', () => {
    expect(isRetryableThreatFeedError(new Error('Status code 502'))).toBe(true)
    expect(isRetryableThreatFeedError(Object.assign(new Error('boom'), { status: 503 }))).toBe(true)
    expect(isRetryableThreatFeedError(Object.assign(new Error('boom'), { status: 404 }))).toBe(false)
    expect(isRetryableThreatFeedError(Object.assign(new Error('boom'), { status: 429 }))).toBe(false)
  })
})
