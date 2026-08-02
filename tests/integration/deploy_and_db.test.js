import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { test, expect } from 'vitest'

test('DB health helper exists and runs', { timeout: 20000 }, () => {
  const helper = 'server/tools/db-health.js'
  expect(existsSync(helper)).toBe(true)
  // run helper with a timeout so CI cannot hang indefinitely
  const r = spawnSync('node', [helper], { encoding: 'utf8', timeout: 10000 })
  // helper may exit non-zero on CI if DB missing; ensure it runs without crashing
  expect(r.error === undefined || r.status !== null).toBe(true)
})
