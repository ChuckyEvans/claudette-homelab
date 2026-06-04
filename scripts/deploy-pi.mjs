#!/usr/bin/env node
/**
 * scripts/deploy-pi.mjs
 * Cross-platform deploy — Claudette → Raspberry Pi
 * Works on Windows, macOS, and Linux — requires only Node.js 22+
 *
 * Usage:
 *   node scripts/deploy-pi.mjs                         # full deploy
 *   node scripts/deploy-pi.mjs --quick                 # sync server/ only (~5 s)
 *   node scripts/deploy-pi.mjs --pre-built             # ship local dist/, skip npm build on Pi
 *   node scripts/deploy-pi.mjs --skip-build            # reuse existing image on Pi
 *   node scripts/deploy-pi.mjs --pi-host 192.168.1.5   # override Pi host
 *   node scripts/deploy-pi.mjs --kodi-host 1.2.3.4     # also deploy Kodi addon
 *
 *   npm run deploy                      same as above via npm script
 *   npm run deploy -- --quick           pass flags through npm
 */

import { spawnSync }                               from 'node:child_process'
import { existsSync, readFileSync, writeFileSync,
         unlinkSync, statSync }                    from 'node:fs'
import { join, resolve, dirname }                  from 'node:path'
import { tmpdir, homedir }                         from 'node:os'
import { fileURLToPath }                           from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..')

// ── ANSI colours (no external deps) ──────────────────────────────────────────
const tty = process.stdout.isTTY
const C = {
  cyan:   s => tty ? `\x1b[36m${s}\x1b[0m` : s,
  green:  s => tty ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: s => tty ? `\x1b[33m${s}\x1b[0m` : s,
  red:    s => tty ? `\x1b[31m${s}\x1b[0m` : s,
  gray:   s => tty ? `\x1b[90m${s}\x1b[0m` : s,
}
const log  = (s, col = 'cyan') => console.log(C[col](s))
const info = s                 => console.log(C.gray(`      ${s}`))
const die  = s                 => { console.error(C.red(`\n  ERROR: ${s}`)); process.exit(1) }

// ── Argument parsing ──────────────────────────────────────────────────────────
const argv  = process.argv.slice(2)
const flag  = k => argv.includes(`--${k}`)
const param = (k, fb = '') => {
  const i = argv.indexOf(`--${k}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb
}

const quick     = flag('quick')
const preBuilt  = flag('pre-built')
const skipBuild = flag('skip-build')
let piHost      = param('pi-host')
let piUser      = param('pi-user')
let sshKey      = param('ssh-key')
const kodiHost  = param('kodi-host')
const kodiUser  = param('kodi-user', 'root')

// ── config.yaml reader (regex-based, zero dependencies) ──────────────────────
function yamlVal(key, fb = '') {
  const f = join(ROOT, 'config.yaml')
  if (!existsSync(f)) return fb
  const m = readFileSync(f, 'utf8').match(new RegExp(`^\\s*${key}:\\s*(.+)`, 'm'))
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : fb
}

function yamlList(key) {
  const f = join(ROOT, 'config.yaml')
  if (!existsSync(f)) return []
  const lines = readFileSync(f, 'utf8').split('\n')
  const result = []
  let on = false
  for (const l of lines) {
    if (new RegExp(`^\\s+${key}:\\s*$`).test(l)) { on = true; continue }
    if (on) {
      const m = l.match(/^\s+-\s+(.+)/)
      if (m) result.push(m[1].trim().replace(/^['"]|['"]$/g, ''))
      else if (l.trim() && !/^\s+-/.test(l)) break
    }
  }
  return result
}

if (!piHost) piHost = yamlVal('host',     '192.168.1.10')
if (!piUser) piUser = yamlVal('ssh_user', 'ubuntu')
if (!sshKey) {
  const raw = yamlVal('ssh_key', '')
  if (raw && !raw.includes('#')) {
    sshKey = raw.replace(/^~/, homedir())
  }
}

const CONTAINER = 'claudette'
const IMAGE     = 'claudette:latest'
const SSH_OPTS  = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'BatchMode=yes',
  ...(sshKey ? ['-i', sshKey] : []),
]

// ── Shell helpers ─────────────────────────────────────────────────────────────
function run(cmd, args, { silent = false, noThrow = false, cwd = ROOT } = {}) {
  const r = spawnSync(cmd, args, {
    stdio:    silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    cwd,
  })
  if (r.error) die(`Cannot run '${cmd}': ${r.error.message}`)
  if (!noThrow && r.status !== 0) die(`${cmd} failed (exit ${r.status})`)
  return (r.stdout ?? '').trim()
}

const remote  = (cmd, opts = {}) => run('ssh',  [...SSH_OPTS, `${piUser}@${piHost}`, cmd], opts)
const scpTo   = (src, dst)       => run('scp',  [...SSH_OPTS, src, dst])
const mkTar   = (file, ...items) => run('tar',  ['-cf', file, '-C', ROOT, ...items])

// ── Main ──────────────────────────────────────────────────────────────────────
console.log()
log(`Deploying Claudette to ${piUser}@${piHost}`)
log('─────────────────────────────────────────────', 'gray')

// ── Quick path: sync server/ into running container ───────────────────────────
if (quick) {
  log('\n[1/2] Uploading server files to Pi...')
  const tar = join(tmpdir(), 'claudette-quick.tar')
  mkTar(tar, 'server')
  info(`Tarball: ${(statSync(tar).size / 1e6).toFixed(1)} MB`)
  scpTo(tar, `${piUser}@${piHost}:/tmp/claudette-quick.tar`)
  unlinkSync(tar)
  info('Uploaded.')

  log('\n[2/2] Installing files + restarting container...')
  remote(
    `sudo docker cp /tmp/claudette-quick.tar ${CONTAINER}:/tmp/claudette-quick.tar` +
    ` && sudo docker exec ${CONTAINER} sh -c 'cd /app && tar xf /tmp/claudette-quick.tar && rm /tmp/claudette-quick.tar'` +
    ` && rm /tmp/claudette-quick.tar && sudo docker restart ${CONTAINER}`
  )
  info('Done.')
  console.log()
  log(`Claudette is running at http://${piHost}:7654`, 'green')
  info(`Logs: ssh ${piUser}@${piHost} 'docker logs -f ${CONTAINER}'`)
  process.exit(0)
}

const cacheBust = Math.floor(Date.now() / 1000)

// ── PreBuilt: ship local dist/, build image without npm build on Pi ───────────
if (preBuilt) {
  log('\n[1/2] Uploading pre-built dist + server (skipping npm build on Pi)...')
  const tar      = join(tmpdir(), 'claudette-src.tar')
  const includes = ['server', 'dist', 'package.json', 'package-lock.json']
    .filter(f => existsSync(join(ROOT, f)))
  mkTar(tar, ...includes)
  info(`Tarball: ${(statSync(tar).size / 1e6).toFixed(1)} MB`)
  scpTo(tar, `${piUser}@${piHost}:/tmp/claudette-src.tar`)
  unlinkSync(tar)

  // Inline Dockerfile: skips the npm build stage, just installs prod deps
  const dockerfileContent = [
    'FROM node:22-alpine',
    "RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && apk add --no-cache nmap nmap-scripts tcpdump curl traceroute mtr",
    'WORKDIR /app',
    'COPY package*.json ./',
    "RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && npm ci --omit=dev",
    'ARG CACHEBUST=1',
    `RUN echo "cachebust=$CACHEBUST"`,
    'COPY server/ ./server/',
    'COPY dist/ ./dist/',
    'RUN mkdir -p /app/data',
    'EXPOSE 7654',
    'ENV NODE_ENV=production',
    'CMD ["node", "server/index.js"]',
  ].join('\n')

  const tmpDf = join(tmpdir(), 'claudette-Dockerfile')
  writeFileSync(tmpDf, dockerfileContent, 'utf8')
  scpTo(tmpDf, `${piUser}@${piHost}:/tmp/claudette-Dockerfile`)
  unlinkSync(tmpDf)

  info('Uploaded. Building on Pi (no npm build)...')
  remote(
    `rm -rf /tmp/claudette-build && mkdir -p /tmp/claudette-build` +
    ` && tar -xf /tmp/claudette-src.tar -C /tmp/claudette-build && rm /tmp/claudette-src.tar` +
    ` && mv /tmp/claudette-Dockerfile /tmp/claudette-build/Dockerfile` +
    ` && cd /tmp/claudette-build && sudo docker build --build-arg CACHEBUST=${cacheBust} -t ${IMAGE} .` +
    ` && cd / && rm -rf /tmp/claudette-build`
  )
  info('Built.')

} else if (!skipBuild) {
  log('\n[1/2] Uploading source + building on Pi (native ARM64)...')
  const tar      = join(tmpdir(), 'claudette-src.tar')
  const includes = [
    'server', 'src', 'public', 'package.json', 'package-lock.json',
    'Dockerfile', 'vite.config.js', 'postcss.config.js',
    'tailwind.config.js', 'index.html', 'eslint.config.js', '.dockerignore',
  ].filter(f => existsSync(join(ROOT, f)))
  mkTar(tar, ...includes)
  info(`Tarball: ${(statSync(tar).size / 1e6).toFixed(1)} MB`)
  scpTo(tar, `${piUser}@${piHost}:/tmp/claudette-src.tar`)
  unlinkSync(tar)

  info('Uploaded. Building on Pi (this takes a few minutes)...')
  remote(
    `rm -rf /tmp/claudette-build && mkdir -p /tmp/claudette-build` +
    ` && tar -xf /tmp/claudette-src.tar -C /tmp/claudette-build && rm /tmp/claudette-src.tar` +
    ` && cd /tmp/claudette-build && sudo docker build --build-arg CACHEBUST=${cacheBust} -t ${IMAGE} .` +
    ` && cd / && rm -rf /tmp/claudette-build`
  )
  info('Built.')

} else {
  info('[1/2] Skipping build — reusing existing image on Pi.')
}

// ── 2. Restart container on Pi ────────────────────────────────────────────────
log('\n[2/2] Restarting container on Pi...')

remote(`sudo docker stop ${CONTAINER} 2>/dev/null || true`, { noThrow: true })
remote(`sudo docker rm   ${CONTAINER} 2>/dev/null || true`, { noThrow: true })

// Probe for DHCP leases file (dnsmasq / pihole) for hostname enrichment
const leasesRaw   = remote(
  'ls /etc/pihole/dhcp.leases /var/lib/misc/dnsmasq.leases 2>/dev/null | head -1',
  { silent: true, noThrow: true }
)
const leasesPath  = leasesRaw.trim()
const leasesMount = leasesPath ? `-v ${leasesPath}:/data/dhcp.leases:ro` : ''
if (leasesPath) info(`DHCP leases: ${leasesPath} will be mounted.`)
else            info('No DHCP leases file found — hostnames from DNS only.')

// Read host DNS servers so the container resolves local .home names
// (Docker overrides with 1.1.1.1 when the host uses private-IP nameservers)
const dnsFlags  = []
const hostDns   = remote(
  "grep '^nameserver' /etc/resolv.conf | sed 's/nameserver //' | head -3",
  { silent: true, noThrow: true }
)
for (const ns of hostDns.split('\n').map(s => s.trim()).filter(Boolean)) {
  dnsFlags.push(`--dns ${ns}`)
  info(`DNS: using ${ns} from host resolv.conf`)
}
for (const dns of yamlList('fallback_dns')) {
  if (/^[0-9a-fA-F.:]+$/.test(dns)) {
    dnsFlags.push(`--dns ${dns}`)
    info(`DNS fallback: ${dns} (from config.yaml)`)
  }
}

remote([
  `sudo docker run -d`,
  `--name ${CONTAINER}`,
  `--restart unless-stopped`,
  `--cap-add NET_ADMIN`,
  `--cap-add NET_RAW`,
  `--network host`,
  ...dnsFlags,
  leasesMount,
  `-v claudette-data:/app/data`,
  IMAGE,
].filter(Boolean).join(' '))

info('Container started.')
console.log()
log(`Claudette is running at http://${piHost}:7654`, 'green')
info(`Logs: ssh ${piUser}@${piHost} 'docker logs -f ${CONTAINER}'`)
console.log()

// ── 3. Kodi addon (optional) ──────────────────────────────────────────────────
if (kodiHost) {
  log(`\n[3/3] Deploying Kodi addon to ${kodiUser}@${kodiHost}...`)
  const kodiOpts = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    ...(sshKey ? ['-i', sshKey] : []),
  ]
  const addonSrc = join(ROOT, 'output', 'kodi', 'plugin.program.claudette')
  run('scp', [...kodiOpts, '-r', addonSrc, `${kodiUser}@${kodiHost}:/storage/.kodi/addons/`],
    { noThrow: true })
  run('ssh', [...kodiOpts, `${kodiUser}@${kodiHost}`,
    'kodi-send --action="UpdateLocalAddons" 2>/dev/null || true'],
    { noThrow: true })
  info('Kodi addon deployed. In Kodi: Settings → Add-ons → My Add-ons → Program add-ons → Claudette')
}
