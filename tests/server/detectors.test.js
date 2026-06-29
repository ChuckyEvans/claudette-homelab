import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, resetDb } from '../../server/db.js'
import { detectIpClashes, detectMacIpChurn, detectBeacons } from '../../server/lib/detectors.js'

beforeEach(() => {
  resetDb()
  const db = getDb()
  db.exec('DELETE FROM ip_history')
  // seed ip_history
  const now = Date.now()
  const inserts = []
  // two devices with same IP => clash
  inserts.push(`('192.168.1.10','AA:BB:CC:DD:EE:01',${now - 1000})`)
  inserts.push(`('192.168.1.10','AA:BB:CC:DD:EE:02',${now - 900})`)
  // mac churn: same mac, different ips
  inserts.push(`('192.168.1.11','AA:BB:CC:DD:EE:03',${now - 800})`)
  inserts.push(`('192.168.1.12','AA:BB:CC:DD:EE:03',${now - 700})`)
  // beacons: repeated mac many times
  for (let i = 0; i < 25; i++) inserts.push(`('192.168.1.${20+i}','AA:BB:CC:DD:EE:04',${now - i*100})`)
  db.exec(`BEGIN TRANSACTION; INSERT INTO ip_history (ip, mac, ts) VALUES ${inserts.join(',')}; COMMIT;`)
})

describe('detectors', () => {
  it('detectIpClashes returns detected clash', async () => {
    const clashes = await detectIpClashes(50)
    expect(Array.isArray(clashes)).toBe(true)
    expect(clashes.find(c => c.ip === '192.168.1.10')).toBeTruthy()
  })

  it('detectMacIpChurn returns churn for mac that moved', async () => {
    const churn = await detectMacIpChurn(50)
    expect(Array.isArray(churn)).toBe(true)
    expect(churn.find(c => c.mac === 'AA:BB:CC:DD:EE:03')).toBeTruthy()
  })

  it('detectBeacons finds beaconing mac', async () => {
    const beacons = await detectBeacons(50)
    expect(Array.isArray(beacons)).toBe(true)
    expect(beacons.find(b => b.mac === 'AA:BB:CC:DD:EE:04')).toBeTruthy()
  })
})
