import { describe, test, expect, afterAll } from 'vitest'
import request from 'supertest'
import { getDb } from '../../server/db.js'
import app from '../../server/index.js'
import fs from 'fs'
import path from 'path'

describe('Evidence endpoints', () => {
  beforeAll(() => {
    // ensure clean evidence dir
    const dir = path.join(process.cwd(), 'data', 'evidence')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })

  afterAll(() => {
    // noop
  })

  test('upload -> list -> download', async () => {
    const ts = Date.now()
    // create a dummy archived outage_diagnostics row so outage exists for tests
    const db = getDb()
    try {
      db.run('INSERT OR IGNORE INTO outage_diagnostics (outage_ts, traceroute, ping_detail, gateway, outage_type, captured_at) VALUES (?, ?, ?, ?, ?, ?)', [ts, 'tr', '[]', null, 'isp', Date.now()])
    } catch (e) {
      // fall back to archived table if original has been renamed
      db.run('INSERT OR IGNORE INTO outage_diagnostics_archived (outage_ts, traceroute, ping_detail, gateway, outage_type, captured_at) VALUES (?, ?, ?, ?, ?, ?)', [ts, 'tr', '[]', null, 'isp', Date.now()])
    }

    const payload = Buffer.from('hello evidence').toString('base64')
    const res = await request(app)
      .post(`/api/reports/outages/${ts}/evidence`)
      .send({ filename: 'test.txt', data: payload })
      .set('Accept', 'application/json')
    expect(res.status).toBe(200)
    const list = await request(app).get(`/api/reports/outages/${ts}/evidence`).expect(200)
    expect(list.body.files.length).toBeGreaterThan(0)
    const fid = list.body.files[0].id
    const dl = await request(app).get(`/api/reports/outages/${ts}/evidence/${fid}/download`).expect(200)
    expect(dl.header['content-disposition']).toMatch(/test.txt/)
  })
})
