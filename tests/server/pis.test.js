import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import bodyParser from 'body-parser'
import pisRouter from '../../server/routes/pis.js'
import { getDb } from '../../server/db.js'

let app

beforeAll(() => {
  app = express()
  app.use(bodyParser.json())
  // mount without auth for tests
  app.use('/api/pis', pisRouter)
})

describe('Pi routes', () => {
  it('returns 404 for missing id', async () => {
    const res = await request(app).get('/api/pis/999999')
    expect(res.status).toBe(404)
  })

  it('creates and updates a pi row via migration-safe table', async () => {
    const db = getDb()
    // ensure table exists and insert a row
    db.exec("INSERT INTO pis (label, host, ssh_user, retention_days, external_paths) VALUES ('testpi','127.0.0.1','ubuntu',7,'[]')")
    const row = db.get('SELECT id FROM pis WHERE host = ?', ['127.0.0.1'])
    expect(row).toBeDefined()
    const id = row.id

    const getRes = await request(app).get(`/api/pis/${id}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.host).toBe('127.0.0.1')

    const putRes = await request(app).put(`/api/pis/${id}`).send({ retention_days: 14, external_paths: ['/etc/hosts'] })
    expect(putRes.status).toBe(200)
    expect(putRes.body.retention_days).toBe(14)
    expect(Array.isArray(putRes.body.external_paths)).toBe(true)
  })
})
