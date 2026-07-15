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
const skipLint = flag('skip-lint')
const skipTests = flag('skip-tests')
const noProgress = flag('no-progress')
let piHost = param('pi-host')
let piUser = param('pi-user')
let sshKey = param('ssh-key')
const kodiHost = param('kodi-host')
const kodiUser = param('kodi-user', 'root')

function yamlVal(key, fb = '') {
  const f = join(ROOT, 'config.yaml')
  if (!existsSync(f)) return fb
  const m = readFileSync(f, 'utf8').match(new RegExp(`^\s*${key}:\s*(.+)`, 'm'))
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : fb
}
function yamlList(key) {
  const f = join(ROOT, 'config.yaml')
  if (!existsSync(f)) return []
  const lines = readFileSync(f, 'utf8').split('\n')
  const result = []
  let on = false
  for (const l of lines) {
    if (new RegExp(`^\s+${key}:\s*$`).test(l)) { on = true; continue }
    if (on) {
      const m = l.match(/^\s+-\s+(.+)/)
      if (m) result.push(m[1].trim().replace(/^['"]|['"]$/g, ''))
      else if (l.trim() && !/^\s+-/.test(l)) break
    }
  }
  return result
}

if (!piHost) piHost = yamlVal('host', '192.168.1.10')
if (!piUser) piUser = yamlVal('ssh_user', 'ubuntu')
if (!sshKey) {
  const raw = yamlVal('ssh_key', '')
  if (raw && !raw.includes('#')) sshKey = raw.replace(/^~/, homedir())
}

const CONTAINER = 'claudette'
const IMAGE = 'claudette:latest'
const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'BatchMode=yes',
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
  const r = spawnSync(cmd, args, { stdio: silent ? 'pipe' : 'inherit', encoding: 'utf8', cwd, shell: false })
  if (r.error && !noThrow) die(`Cannot run '${cmd}': ${r.error.message}`)
  if (!noThrow && r.status !== 0) die(`${cmd} failed (exit ${r.status})`)
  return (r.stdout ?? '').trim()
}

function resolveNpmCmdSync() {
  if (process.platform !== 'win32') return 'npm'
  try {
    const r = spawnSync('npm.cmd', ['--version'], { encoding: 'utf8', shell: false })
    if (!r.error && r.status === 0) return 'npm.cmd'
  } catch (e) {}
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
  run(NPM_CMD, ['run', 'test'], { noThrow: false })
  info('Tests passed.')
} else info('Skipping tests (flag: --skip-tests)')

emitProgress({ step: 'prechecks', progress: 0.05, message: 'pre-deploy checks complete' })

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
  log('\n[1/2] Uploading pre-built dist + server (skipping npm build on Pi)...')
  const tar = join(tmpdir(), 'claudette-src.tar')
  const includes = ['server', 'dist', 'package.json', 'package-lock.json'].filter(f => existsSync(join(ROOT, f)))
  mkTar(tar, ...includes)
  scpTo(tar, `${piUser}@${piHost}:/home/${piUser}/claudette-src.tar`)
  unlinkSync(tar)
  const dockerfileContent = [
    'FROM node:22-alpine',
    "RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && apk add --no-cache nmap tcpdump curl",
    'WORKDIR /app',
    'COPY package*.json ./',
    "RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && npm ci --omit=dev",
    'ARG CACHEBUST=1',
    'COPY server/ ./server/',
    'COPY dist/ ./dist/',
    'RUN mkdir -p /app/data',
    'EXPOSE 7654',
    'ENV NODE_ENV=production',
    'CMD ["node","server/index.js"]',
  ].join('\n')
  const tmpDf = join(tmpdir(), 'claudette-Dockerfile')
  writeFileSync(tmpDf, dockerfileContent, 'utf8')
  scpTo(tmpDf, `${piUser}@${piHost}:/home/${piUser}/claudette-Dockerfile`)
  unlinkSync(tmpDf)
  info('Uploaded. Building on Pi (no npm build)...')
  remote([
    'rm -rf /tmp/claudette-build || true',
    'mkdir -p /tmp/claudette-build',
    `tar -xf /home/${piUser}/claudette-src.tar -C /tmp/claudette-build`,
    `mv /home/${piUser}/claudette-Dockerfile /tmp/claudette-build/Dockerfile || true`,
    `cd /tmp/claudette-build && sudo docker build --build-arg CACHEBUST=${Date.now()} -t ${IMAGE} .`,
    'cd / && rm -rf /tmp/claudette-build || true',
  ].join(' && '))
  info('Built.')
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
    `cd /tmp/claudette-build && sudo docker build --build-arg CACHEBUST=${Date.now()} -t ${IMAGE} . 2>&1 | tee /tmp/claudette-build/build.log`,
    'emit "{\"step\":\"done\",\"progress\":0.9,\"message\":\"build finished\"}"',
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

info('Ensuring host data directory backups and config restoration...')
try {
  const restoreScript = [
    'set -e',
    'DATA=/home/' + piUser + '/claudette-data',
    'BACK=/home/' + piUser + '/claudette-backups',
    'mkdir -p "$BACK"',
    'TS=$(date -u +%Y%m%dT%H%M%SZ)',
    'if [ -f "$DATA/claudette.db" ]; then sudo cp -v "$DATA/claudette.db" "$BACK/claudette.db.$TS.bak" || true; else echo No DB to backup; fi',
    'if [ -f "$DATA/config.yaml" ]; then sudo cp -v "$DATA/config.yaml" "$BACK/config.yaml.$TS.bak" || true; else echo No config to backup; fi',
    "CAND_DB=$(ls -1t \"$DATA/claudette.db*\" \"$BACK/claudette.db.*\" 2>/dev/null | head -n1 || true)",
    'if [ -n "$CAND_DB" ] && [ -f "$CAND_DB" ]; then echo Restoring DB from $CAND_DB; sudo cp -v "$CAND_DB" "$DATA/claudette.db"; sudo chown 1000:1000 "$DATA/claudette.db" || true; else echo No DB candidate found; fi',
    "CAND_CFG=$(ls -1t \"$DATA/config.yaml*\" \"$BACK/config.yaml.*\" 2>/dev/null | head -n1 || true)",
    'if [ -n "$CAND_CFG" ] && [ -f "$CAND_CFG" ]; then echo Restoring config from $CAND_CFG; sudo cp -v "$CAND_CFG" "$DATA/config.yaml"; sudo chown 1000:1000 "$DATA/config.yaml" || true; else echo No config candidate found; fi',
  ].join(' && ')
  remote(restoreScript, { silent: true, noThrow: true })
} catch (e) {
  info('Warning: restore step failed — continuing to start container')
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