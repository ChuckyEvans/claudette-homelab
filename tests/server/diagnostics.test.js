import request from 'supertest'
import express from 'express'
import diagnosticsRouter from '../../server/routes/diagnostics.js'
import { describe, test, expect } from 'vitest'

// Simple in-memory express app mounting the route
const app = express()
app.use('/api/diagnostics', diagnosticsRouter)

describe('GET /api/diagnostics/latest', () => {
  test('returns 200 and JSON body', async () => {
    const res = await request(app).get('/api/diagnostics/latest')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('ok', true)
    // row may be null if DB empty
    expect(res.body).toHaveProperty('row')
  })
})
