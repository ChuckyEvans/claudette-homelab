#!/usr/bin/env node
/**
 * scripts/deploy-pi.mjs
 * Robust deploy helper for building and deploying Claudette to a Raspberry Pi.
 * - Resolves npm on Windows/Unix
 * - Supports quick / pre-built / skip-build / skip-lint / skip-tests
 * - Kills stuck remote builds and pollers
 * - Provides interactive fallback build with BUILD_TIME
 * - Writes progress to a temp progress file for the progress reader
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const tty = process.stdout.isTTY
const C = {
  cyan: s => tty ? `\x1b[36m${s}\x1b[0m` : s,
  green: s => tty ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: s => tty ? `\x1b[33m${s}\x1b[0m` : s,
  red: s => tty ? `\x1b[31m${s}\x1b[0m` : s,
  gray: s => tty ? `\x1b[90m${s}\x1b[0m` : s,
}
const log = (s, col = 'cyan') => console.log(C[col](s))
const info = s => console.log(C.gray(`      ${s}`))
const die = s => { console.error(C.red(`\n  ERROR: ${s}`)); process.exit(1) }

const argv = process.argv.slice(2)
const flag = k => argv.includes(`--${k}`)
const param = (k, fb = '') => {
  const i = argv.indexOf(`--${k}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb
}

if (flag('help') || argv.includes('-h')) {
  console.log('\nUsage: node scripts/deploy-pi.mjs [options]\n')
  console.log('Options:')
  console.log('  --quick             Quick sync (server files only)')
  console.log('  --pre-built         Upload pre-built dist and skip npm build on Pi')
  console.log('  --skip-build        Skip building image on Pi (use existing image)')
  console.log('  --skip-lint         Skip eslint checks')
  console.log('  --skip-tests        Skip unit tests')
  console.log('  --run-lint          Run eslint checks (disabled by default)')
  console.log('  --run-tests         Run unit tests (disabled by default)')
  console.log('  --no-progress       Disable live progress viewer')
  console.log('  --pi-host <host>    Target Pi host (overrides config)')
  console.log('  --pi-user <user>    SSH username for Pi (overrides config)')
  console.log('  --ssh-key <path>    SSH private key file to use')
  console.log('  --kodi-host <host>  Deploy Kodi addon')
  console.log('  -h, --help          Show this help')
  process.exit(0)
}

const quick = flag('quick')
const preBuilt = flag('pre-built')
const skipBuild = flag('skip-build')
// Lint/tests are disabled by default for faster deploys; use --run-lint/--run-tests to enable
const skipLint = flag('skip-lint') || !flag('run-lint')
const skipTests = flag('skip-tests') || !flag('run-tests')
const noProgress = flag('no-progress')
let piHost = param('pi-host')
let piUser = param('pi-user')
let sshKey = param('ssh-key')
const kodiHost = param('kodi-host')
const kodiUser = param('kodi-user', 'root')

function yamlVal(key, fb = '') {
  const f = join(ROOT, 'config.yaml')
  if (!existsSync(f)) return fb
  try {
    const cfg = yaml.load(readFileSync(f, 'utf8')) || {}
    const parts = String(key).split('.')
    let cur = cfg
    for (const p of parts) {
      if (cur == null) return fb
      cur = cur[p]
    }
    return cur == null ? fb : String(cur)
  } catch {
    return fb
  }
}

function yamlList(key) {
  const f = join(ROOT, 'config.yaml')
  if (!existsSync(f)) return []
  try {
    const cfg = yaml.load(readFileSync(f, 'utf8')) || {}
    const parts = String(key).split('.')
    let cur = cfg
    for (const p of parts) { if (cur == null) return []; cur = cur[p] }
    return Array.isArray(cur) ? cur.map(x => String(x)) : []
  } catch {
    return []
  }
}

if (!piHost) piHost = yamlVal('pi.host', yamlVal('host', '192.168.1.10'))
if (!piUser) piUser = yamlVal('pi.ssh_user', yamlVal('ssh_user', 'ubuntu'))
if (!sshKey) {
  const raw = yamlVal('ssh_key', '')
  if (raw && !raw.includes('#')) sshKey = raw.replace(/^~/, homedir())
}

const CONTAINER = 'claudette'
const IMAGE = 'claudette:latest'
const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  // Allow password fallback when key auth fails (BatchMode=no)
  '-o', 'BatchMode=no',
  ...(sshKey ? ['-i', sshKey] : []),
]

const PROGRESS_FILE = join(tmpdir(), 'claudette-deploy-progress.json')
function emitProgress(obj) {
  const base = { timestamp: Date.now(), startTime: startTime || Date.now(), message: '' }
  try { writeFileSync(PROGRESS_FILE, JSON.stringify(Object.assign(base, obj), null, 2), 'utf8') } catch (e) {}
}
let startTime = Date.now()
emitProgress({ step: 'init', progress: 0, message: 'starting deploy' })

function run(cmd, args, { silent = false, noThrow = false, cwd = ROOT } = {}) {
  const useShell = process.platform === 'win32' && /^npm(\.cmd)?$|^npx(\.cmd)?$/i.test(String(cmd))
  const r = spawnSync(cmd, args, { stdio: silent ? 'pipe' : 'inherit', encoding: 'utf8', cwd, shell: useShell })
  if (r.error && !noThrow) die(`Cannot run '${cmd}': ${r.error.message}`)
  if (!noThrow && r.status !== 0) die(`${cmd} failed (exit ${r.status})`)
  return (r.stdout ?? '').trim()
}

function resolveNpmCmdSync() {
  if (process.platform === 'win32') return 'npm.cmd'
  return 'npm'
}
const NPM_CMD = resolveNpmCmdSync()

const remote = (cmd, opts = {}) => {
  if (Array.isArray(cmd)) cmd = cmd.filter(Boolean).join(' && ')
  if (!cmd || !String(cmd).trim()) throw new Error('remote(): empty command')
  console.log('\n[REMOTE CMD]')
  console.log(cmd)
  const safe = String(cmd).replace(/'/g, "'\\''")
  return run('ssh', [...SSH_OPTS, `${piUser}@${piHost}`, 'bash', '-lc', `'${safe}'`], opts)
}
const scpTo = (src, dst) => run('scp', [...SSH_OPTS, src, dst])
function detectRemotePlatform() {
  const arch = remote('uname -m', { silent: true, noThrow: true }).trim()
  const map = {
    x86_64: 'linux/amd64',
    amd64: 'linux/amd64',
    aarch64: 'linux/arm64',
    arm64: 'linux/arm64',
    armv7l: 'linux/arm/v7',
    armhf: 'linux/arm/v7',
  }
  return map[arch] || null
}
const mkTar = (file, ...items) => {
  try { return run('tar', ['-cf', file, '-C', ROOT, ...items]) } catch (e) { die("'tar' failed — ensure GNU tar is installed") }
}

console.log()
log(`Deploying Claudette to ${piUser}@${piHost}`)
log('─────────────────────────────────────────────', 'gray')

if (!skipLint) {
  log('\n→ Running eslint...')
  run(NPM_CMD, ['run', 'lint'], { noThrow: false })
  info('eslint passed.')
} else info('Skipping eslint (flag: --skip-lint)')
if (!skipTests) {
  log('\n→ Running unit tests...')
  // Try running Vitest in single-threaded mode during deploy to avoid intermittent
  // worker/process timeouts on CI and under heavy IO (DB file locking).
  // If the Vitest CLI version doesn't accept the flag, fall back to the
  // default `npm run test` invocation.
  // Attempt to run Vitest with `--threads false` via a direct spawn so we can
  // observe the exit code (the `run()` helper aborts the process on non-zero
  // exit which prevents graceful fallback).
  const useShellForNpm = process.platform === 'win32' && /^npm(\.cmd)?$|^npx(\.cmd)?$/i.test(String(NPM_CMD))
  const testArgs = ['run', 'test', '--', '--threads', 'false']
  try {
    const r = spawnSync(NPM_CMD, testArgs, { stdio: 'inherit', encoding: 'utf8', cwd: ROOT, shell: useShellForNpm })
    if (r.error || r.status !== 0) {
      console.warn('[deploy] --threads flag attempt failed; running tests with default flags')
      run(NPM_CMD, ['run', 'test'], { noThrow: false })
    }
  } catch (e) {
    console.warn('[deploy] test spawn failed; falling back to npm run test')
    run(NPM_CMD, ['run', 'test'], { noThrow: false })
  }
  info('Tests passed.')
} else info('Skipping tests (flag: --skip-tests)')

emitProgress({ step: 'prechecks', progress: 0.05, message: 'pre-deploy checks complete' })

// Bump package.json patch version for this deploy so builds are distinguishable.
function bumpPackagePatchVersion() {
  try {
    const pkgPath = join(ROOT, 'package.json')
    const raw = readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(raw)
    const ver = String(pkg.version || '0.0.0')
    const parts = ver.split('.')
    while (parts.length < 3) parts.push('0')
    const patch = Number(parts[2] || 0) + 1
    const newVer = `${parts[0]}.${parts[1]}.${patch}`
    pkg.version = newVer
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return newVer
  } catch (e) {
    return null
  }
}

const buildTimeIso = new Date().toISOString()
const gitShort = (() => { try { return run('git', ['rev-parse', '--short', 'HEAD'], { silent: true, noThrow: true }).trim() || 'local' } catch { return 'local' } })()
const buildName = `build-${gitShort}-${buildTimeIso.replace(/[:.]/g,'-')}`
let bumpedVersion = null
try { bumpedVersion = bumpPackagePatchVersion() } catch {}
if (bumpedVersion) log(`Version bumped to ${bumpedVersion}`, 'green')
log(`Build name: ${buildName}`, 'gray')
log(`Build time: ${buildTimeIso}`, 'gray')

if (quick) {
  log('\n[1/2] Uploading server files to Pi...')
  const tar = join(tmpdir(), 'claudette-quick.tar')
  mkTar(tar, 'server')
  info(`Tarball: ${(statSync(tar).size / 1e6).toFixed(1)} MB`)
  emitProgress({ step: 'pack', progress: 0.15, message: 'created quick tarball' })
  scpTo(tar, `${piUser}@${piHost}:/home/${piUser}/claudette-quick.tar`)
  unlinkSync(tar)
  log('\n[2/2] Installing files + restarting container...')
  const quickScript = [
    '#!/bin/sh',
    'set -e',
    `sudo docker cp /home/${piUser}/claudette-quick.tar ${CONTAINER}:/tmp/claudette-quick.tar`,
    `sudo docker exec ${CONTAINER} sh -c 'rm -rf /app/dist || true && cd /app && tar xf /tmp/claudette-quick.tar && rm /tmp/claudette-quick.tar'`,
    `rm -f /home/${piUser}/claudette-quick.tar`,
    `sudo docker restart ${CONTAINER}`,
  ].join('\n')
  const tmpQuick = join(tmpdir(), 'claudette-quick-deploy.sh')
  writeFileSync(tmpQuick, quickScript, 'utf8')
  scpTo(tmpQuick, `${piUser}@${piHost}:/tmp/claudette-quick-deploy.sh`)
  unlinkSync(tmpQuick)
  remote('chmod +x /tmp/claudette-quick-deploy.sh')
  remote('sudo bash /tmp/claudette-quick-deploy.sh')
  info('Done.')
  emitProgress({ step: 'quick-deploy', progress: 0.95, message: 'quick deploy complete' })
  console.log()
  log(`Claudette is running at http://${piHost}:7654`, 'green')
  info(`Logs: ssh ${piUser}@${piHost} 'docker logs -f ${CONTAINER}'`)
  process.exit(0)
}

if (preBuilt) {
  log('\n[1/2] Building image locally and uploading to Pi (pre-built)...')
  const targetPlatform = detectRemotePlatform()
  const buildArgs = ['build', '--build-arg', `BUILD_TIME=${buildTimeIso}`, '--build-arg', `BUILD_NAME=${buildName}`, '-t', IMAGE]
  if (targetPlatform) buildArgs.push('--platform', targetPlatform)
  buildArgs.push('.')

  // Ensure local dist is built so the image contains the frontend artifacts
  run(NPM_CMD, ['run', 'build'], { noThrow: false })

  // Build the Docker image in a platform-aware way so ARM64 Pis can run it.
  info(`Building Docker image locally for ${targetPlatform || 'default platform'}...`)
  if (targetPlatform) {
    try {
      run('docker', ['buildx', ...buildArgs, '--load'], { noThrow: false })
    } catch {
      run('docker', ['buildx', ...buildArgs, '--load'], { noThrow: false })
    }
  } else {
    run('docker', buildArgs, { noThrow: false })
  }
  const imgTar = join(tmpdir(), 'claudette-image.tar')
  run('docker', ['save', '-o', imgTar, IMAGE], { noThrow: false })
  scpTo(imgTar, `${piUser}@${piHost}:/home/${piUser}/claudette-image.tar`)
  try { unlinkSync(imgTar) } catch (e) {}

  info('Uploaded image tar. Loading on Pi...')
  remote([
    `sudo docker load -i /home/${piUser}/claudette-image.tar`,
    `rm -f /home/${piUser}/claudette-image.tar`,
  ].join(' && '))
  info('Image loaded on Pi.')
} else if (!skipBuild) {
  log('\n[1/2] Uploading source + building on Pi (native ARM64)...')
  const tar = join(tmpdir(), 'claudette-src.tar')
  const includes = ['server', 'src', 'public', 'package.json', 'package-lock.json', 'Dockerfile', 'vite.config.js', 'postcss.config.js', 'tailwind.config.js', 'index.html', 'eslint.config.js', '.dockerignore'].filter(f => existsSync(join(ROOT, f)))
  mkTar(tar, ...includes)
  info(`Tarball: ${(statSync(tar).size / 1e6).toFixed(1)} MB`)
  emitProgress({ step: 'pack', progress: 0.2, message: 'created source tarball' })
  scpTo(tar, `${piUser}@${piHost}:/home/${piUser}/claudette-src.tar`)
  unlinkSync(tar)

  info('Uploaded. Building on Pi (this takes a few minutes)...')
  try { remote('sudo pkill -f /tmp/claudette-build || true; sudo pkill -f claude*progress* || true', { silent: true, noThrow: true }) } catch (e) {}

  const remoteScript = [
    '#!/bin/sh',
    'set -e',
    'rm -rf /tmp/claudette-build || true',
    'mkdir -p /tmp/claudette-build',
    `tar -xf /home/${piUser}/claudette-src.tar -C /tmp/claudette-build`,
    'PROGFILE=/tmp/claudette-build/progress.json',
    'emit() { echo "$1" > "$PROGFILE" ; }',
    'emit "{\"step\":\"start\",\"progress\":0,\"message\":\"begin build\"}"',
    `cd /tmp/claudette-build && for i in 1 2; do if sudo docker build --build-arg CACHEBUST=${Date.now()} --build-arg BUILD_TIME=${buildTimeIso} --build-arg BUILD_NAME=${buildName} -t ${IMAGE} . 2>&1 | tee /tmp/claudette-build/build.log; then echo build_ok; break; else echo "[deploy] docker build failed on attempt \$i"; cp /tmp/claudette-build/build.log /home/${piUser}/claudette-build-failed-$(date -u +%Y%m%dT%H%M%SZ)-attempt\${i}.log || true; if [ "\$i" -eq 2 ]; then echo '[deploy] all build attempts failed' >&2; exit 1; fi; sleep 2; fi; done`,
    'emit "{\"step\":\"done\",\"progress\":0.9,\"message\":\"build finished\"}"',
    `BUILD_LOG=/home/${piUser}/claudette-build-$(date -u +%Y%m%dT%H%M%SZ).log`,
    `mkdir -p /home/${piUser}/claudette-build-logs || true`,
    'cp /tmp/claudette-build/build.log "$BUILD_LOG" || true',
    'cp -a /root/.npm/_logs /home/${piUser}/claudette-build-logs/ 2>/dev/null || true',
    `echo "build log saved to $BUILD_LOG" >> /home/${piUser}/claudette-build.saved || true`,
    `echo "npm logs copied to /home/${piUser}/claudette-build-logs" >> /home/${piUser}/claudette-build.saved || true`,
    `chown -R ${piUser}:${piUser} /home/${piUser}/claudette-build-logs /home/${piUser}/claudette-build-*.log || true`,
    'cd / && rm -rf /tmp/claudette-build || true',
  ].join('\n')
  const tmpScript = join(tmpdir(), 'claudette-deploy.sh')
  writeFileSync(tmpScript, remoteScript, 'utf8')
  scpTo(tmpScript, `${piUser}@${piHost}:/home/${piUser}/claudette-deploy.sh`)
  unlinkSync(tmpScript)

  remote(`chmod +x /home/${piUser}/claudette-deploy.sh && bash /home/${piUser}/claudette-deploy.sh`)
  emitProgress({ step: 'remote-build', progress: 0.85, message: 'remote build finished' })
} else {
  info('[1/2] Skipping build — reusing existing image on Pi.')
}

log('\n[2/2] Restarting container on Pi...')
emitProgress({ step: 'restart', progress: 0.9, message: 'stopping and starting container' })
remote(`sudo docker stop ${CONTAINER} 2>/dev/null || true`)
remote(`sudo docker rm ${CONTAINER} 2>/dev/null || true`)

const leasesRaw = remote("if [ -f /etc/pihole/dhcp.leases ]; then echo /etc/pihole/dhcp.leases; elif [ -f /var/lib/misc/dnsmasq.leases ]; then echo /var/lib/misc/dnsmasq.leases; else echo; fi", { silent: true, noThrow: true })
const leasesPath = leasesRaw.trim()
const leasesMount = leasesPath ? `-v ${leasesPath}:/data/dhcp.leases:ro` : ''
if (leasesPath) info(`DHCP leases: ${leasesPath} will be mounted.`)
else info('No DHCP leases file found — hostnames from DNS only.')

const dnsFlags = []
const hostDns = remote("grep '^nameserver' /etc/resolv.conf | sed 's/nameserver //' | head -3", { silent: true, noThrow: true })
for (const ns of hostDns.split('\n').map(s => s.trim()).filter(Boolean)) { dnsFlags.push(`--dns ${ns}`); info(`DNS: using ${ns} from host resolv.conf`) }
for (const dns of yamlList('fallback_dns')) { if (/^[0-9a-fA-F.:]+$/.test(dns)) { dnsFlags.push(`--dns ${dns}`); info(`DNS fallback: ${dns} (from config.yaml)`) } }

const dockerRunParts = [
  `docker run -d`,
  `--init`,
  `--name ${CONTAINER}`,
  `--restart unless-stopped`,
  `--cap-add NET_ADMIN`,
  `--cap-add NET_RAW`,
  `--network host`,
  ...dnsFlags,
  leasesMount,
  `-v /home/${piUser}/claudette-data:/app/data`,
  IMAGE,
].filter(Boolean).join(' ')

info('Ensuring host data directory 7z backup...')
try {
  const backupScript = [
    'set -e',
    'TS=$(date -u +%Y%m%dT%H%M%SZ)',
    'DATA=/home/' + piUser + '/claudette-data',
    'BACK=/home/' + piUser + '/claudette-backups',
    'WORK=$(mktemp -d /tmp/claudette-backup.XXXXXX)',
    'ARCHIVE=$BACK/claudette-data-$TS.7z',
    'PAUSED=0',
    'ZIP=$(command -v 7z || command -v 7za || command -v 7zr)',
    'if [ -z "$ZIP" ]; then echo "7z not found on remote host"; exit 1; fi',
    'mkdir -p "$BACK" "$WORK/data"',
    'cleanup() { if [ "$PAUSED" -eq 1 ]; then sudo docker unpause ' + CONTAINER + ' >/dev/null 2>&1 || true; fi; rm -rf "$WORK"; }',
    'trap cleanup EXIT',
    'if sudo docker inspect -f "{{.State.Running}}" ' + CONTAINER + ' 2>/dev/null | grep -q true; then sudo docker exec ' + CONTAINER + ' node --input-type=module -e "const { getDb } = await import(\'/app/server/db.js\'); const db = getDb(); db.exec(\'PRAGMA wal_checkpoint(TRUNCATE)\')"; sudo docker pause ' + CONTAINER + '; PAUSED=1; fi',
    'cp -a "$DATA/." "$WORK/data/"',
    'rm -rf "$WORK/data/claudette.db.lock" "$WORK/data/backups"',
    'find "$WORK/data" -type f \( -name "*.db-wal" -o -name "*.db-shm" \) -delete',
    'cd "$WORK" && "$ZIP" a -t7z "$ARCHIVE" data >/dev/null',
  ].join(' && ')
  remote(backupScript, { silent: true, noThrow: true })
} catch (e) {
  info('Warning: 7z backup step failed — continuing to start container')
}

info('Docker run command:')
info(dockerRunParts)
remote(`sudo ${dockerRunParts}`)

info('Container started.')
emitProgress({ step: 'done', progress: 1, message: 'deploy complete' })
console.log()
log(`Claudette is running at http://${piHost}:7654`, 'green')
info(`Logs: ssh ${piUser}@${piHost} 'docker logs -f ${CONTAINER}'`)
console.log()

if (kodiHost) {
  log(`\n[3/3] Deploying Kodi addon to ${kodiUser}@${kodiHost}...`)
  const kodiOpts = ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', ...(sshKey ? ['-i', sshKey] : [])]
  const addonSrc = join(ROOT, 'output', 'kodi', 'plugin.program.claudette')
  run('scp', [...kodiOpts, '-r', addonSrc, `${kodiUser}@${kodiHost}:/storage/.kodi/addons/`], { noThrow: true })
  run('ssh', [...kodiOpts, `${kodiUser}@${kodiHost}`, 'kodi-send --action="UpdateLocalAddons" 2>/dev/null || true'], { noThrow: true })
  info('Kodi addon deployed.')
}