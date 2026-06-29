import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resetDb, getDb, getDataDir, audit } from '../../server/db.js'
import { persistSpeedTestRow } from '../../server/utils/speedtest.js'
import { readDdnsHistory } from '../../server/utils/ddns.js'

const DATA_DIR = getDataDir()

beforeAll(() => {
  // Ensure a clean test DB for this worker
  process.env.VITEST = '1'
  resetDb()
})

afterAll(() => {
  // leave test DB for inspection if needed
})

describe('persistence layer', () => {
  it('writes and reads audit internet.check', () => {
    audit('internet.check', { ok: false, rtt: 123, vpn_ok: false })
    const row = getDb().get("SELECT event, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts DESC LIMIT 1")
    expect(row).toBeTruthy()
    const payload = JSON.parse(row.payload)
    expect(payload).toHaveProperty('ok')
    expect(payload.rtt).toBe(123)
  })

  it('persists a speedtest row to speedtest_results', () => {
    const ts = Date.now()
    const row = { ts, client_ip: '1.2.3.4', client_isp: 'TestISP', ping_ms: 12.3, download_mbps: 50.5, upload_mbps: 10.1, via: 'direct', provider: 'cloudflare' }
    persistSpeedTestRow(row)
    const saved = getDb().get('SELECT client_ip, client_isp, ping_ms, download_mbps, upload_mbps, via, provider FROM speedtest_results WHERE ts = ?', [ts])
    expect(saved).toBeTruthy()
    expect(saved.client_ip).toBe('1.2.3.4')
    expect(saved.client_isp).toBe('TestISP')
    expect(saved.provider).toBe('cloudflare')
  })

  it('reads ddns history file', () => {
    const histFile = path.join(DATA_DIR, 'ddns-history.json')
    const sample = [{ ts: Date.now(), event: 'ip_changed', old_ip: null, new_ip: '1.2.3.4' }]
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(histFile, JSON.stringify(sample, null, 2))
    const h = readDdnsHistory()
    expect(Array.isArray(h)).toBe(true)
    expect(h[0]).toHaveProperty('event', 'ip_changed')
  })
})
