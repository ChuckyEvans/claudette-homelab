#!/usr/bin/env node
/**
 * scripts/run-docker.mjs
 * Cross-platform: build and run Claudette locally using Docker.
 * Works on Windows (Docker Desktop), macOS, and Linux.
 *
 * Usage:
 *   node scripts/run-docker.mjs               # full build + restart
 *   node scripts/run-docker.mjs --skip-build  # restart without rebuilding
 *
 *   npm run docker:rebuild                    # via npm script
 */

import { spawnSync }        from 'node:child_process'
import { existsSync }       from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath }    from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..')

// ── ANSI colours ──────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY
const C = {
  cyan:  s => tty ? `\x1b[36m${s}\x1b[0m` : s,
  green: s => tty ? `\x1b[32m${s}\x1b[0m` : s,
  gray:  s => tty ? `\x1b[90m${s}\x1b[0m` : s,
  red:   s => tty ? `\x1b[31m${s}\x1b[0m` : s,
}
const log  = (s, col = 'cyan') => console.log(C[col](s))
const info = s                 => console.log(C.gray(`      ${s}`))
const die  = s                 => { console.error(C.red(`\n  ERROR: ${s}`)); process.exit(1) }

const argv      = process.argv.slice(2)
const skipBuild = argv.includes('--skip-build')

const IMAGE     = 'claudette:latest'
const CONTAINER = 'claudette'

function run(cmd, args, { noThrow = false, env } = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd:   ROOT,
    ...(env ? { env } : {}),
  })
  if (r.error) die(`Cannot run '${cmd}': ${r.error.message}`)
  if (!noThrow && r.status !== 0) die(`${cmd} exited with ${r.status}`)
  return r.status
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', cwd: ROOT })
  return (r.stdout ?? '').trim()
}

// ── sleep: sync-sleep without busy-wait ───────────────────────────────────────
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// ── Main ──────────────────────────────────────────────────────────────────────
console.log()
log('Deploying Claudette locally (Docker)')
log('─────────────────────────────────────────────', 'gray')

// 1. Stop and remove existing container
log('\n[1/3] Stopping existing container...')
const existing = capture('docker', ['ps', '-aq', '--filter', `name=^${CONTAINER}$`])
if (existing) {
  run('docker', ['stop', CONTAINER], { noThrow: true })
  run('docker', ['rm',   CONTAINER], { noThrow: true })
  info(`Stopped and removed '${CONTAINER}'.`)
} else {
  info('No running container found, skipping.')
}

// 2. Build image
if (!skipBuild) {
  log('\n[2/3] Building image...')
  // Classic builder (DOCKER_BUILDKIT=0) is more reliable with Docker Desktop's
  // intermittently flaky DNS proxy — avoids auth.docker.io metadata fetches.
  const buildEnv = { ...process.env, DOCKER_BUILDKIT: '0' }
  let built = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync('docker', ['build', '-t', IMAGE, '.'], {
      stdio: 'inherit',
      cwd:   ROOT,
      env:   buildEnv,
    })
    if (r.status === 0) { built = true; break }
    if (attempt < 3) {
      info(`Build failed (DNS timeout?), retrying in 5 s... (${attempt}/3)`)
      sleep(5000)
    }
  }
  if (!built) die('Docker build failed after 3 attempts. Restart Docker Desktop and try again.')
  info('Build successful.')
} else {
  info('[2/3] Skipping build (--skip-build).')
}

// 3. Start container
log('\n[3/3] Starting container...')

// Mount DHCP leases file if present (dnsmasq / pihole) for hostname enrichment
const leasesCandidates = ['/etc/pihole/dhcp.leases', '/var/lib/misc/dnsmasq.leases']
const leasesFile       = leasesCandidates.find(f => existsSync(f))
const leasesArgs       = leasesFile ? ['-v', `${leasesFile}:/data/dhcp.leases:ro`] : []
if (leasesFile) info(`DHCP leases: ${leasesFile} will be mounted.`)

run('docker', [
  'run', '-d',
  '--name',        CONTAINER,
  '--restart',     'unless-stopped',
  '--cap-add',     'NET_ADMIN',
  '--cap-add',     'NET_RAW',
  '-p',            '7654:7654',
  '-v',            'claudette-data:/app/data',
  ...leasesArgs,
  IMAGE,
])
info('Container started.')

console.log()
log('Claudette is running at http://localhost:7654', 'green')
info(`Logs: docker logs -f ${CONTAINER}`)
console.log()
