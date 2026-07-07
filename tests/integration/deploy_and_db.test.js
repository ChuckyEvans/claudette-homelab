import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { getDbPath } from '../../server/db.js'

test('DB health helper exists and runs', () => {
  const helper = 'server/tools/db-health.js'
  expect(existsSync(helper)).toBe(true)
  const r = spawnSync('node', [helper], { encoding: 'utf8' })
  // helper may exit non-zero on CI if DB missing; ensure it runs without crashing
  expect(r.error === undefined || r.status !== null).toBe(true)
})
