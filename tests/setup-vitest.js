import { vi } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import child_process from 'node:child_process'
import dns from 'node:dns'

// Prevent accidental external network or system access during tests.
const die = (..._args) => { throw new Error('External IO disabled during tests') }

// Disable HTTP/HTTPS
http.request = die
http.get = die
https.request = die
https.get = die

// Disable child process execution/spawns
child_process.exec = die
child_process.execFile = die
child_process.spawn = die
child_process.execSync = die
child_process.spawnSync = die

// Disable DNS lookups
dns.lookup = (...args) => {
  const cb = args[args.length - 1]
  if (typeof cb === 'function') return cb(new Error('DNS disabled during tests'))
  throw new Error('DNS disabled during tests')
}

// Disable global fetch if present
if (typeof globalThis.fetch !== 'undefined') {
  globalThis.fetch = () => Promise.reject(new Error('External network disabled during tests'))
}

// Mock common external modules that tests may import
vi.mock('node-ssh', () => ({ NodeSSH: class { connect() { throw new Error('SSH disabled during tests') } } }))

// Provide a no-op for rss-parser (which would fetch remote feeds)
vi.mock('rss-parser', () => ({ default: class RSSParser { async parseURL() { throw new Error('RSS fetch disabled during tests') } } }))

// If tests need to opt-out of these restrictions, they can call `vi.unmock(...)` or restore
// specific functions within their own test scope.

// Ensure mocks and spies don't leak between tests
import { afterEach } from 'vitest'
afterEach(() => {
  try { vi.restoreAllMocks() } catch { /* ignore */ }
  try { vi.resetAllMocks() } catch { /* ignore */ }
})
