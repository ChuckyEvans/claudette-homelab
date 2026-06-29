import request from 'supertest'
import { describe, it, expect } from 'vitest'
import app from '../../server/index.js'

describe('GET /api/reports/outages', () => {
  it('returns pagination fields and outages array', async () => {
    const res = await request(app).get('/api/reports/outages?page=1&limit=10')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('outages')
    expect(Array.isArray(res.body.outages)).toBe(true)
    expect(res.body).toHaveProperty('totalOutages')
    expect(res.body).toHaveProperty('page')
    expect(res.body).toHaveProperty('limit')
  }, 10000)
})
