#!/usr/bin/env node
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

function run(cmd, args, opts={}){
  console.log('>', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if(r.status !== 0) throw new Error(`${cmd} failed: ${r.status}`)
}

function usage(){
  console.log('Usage: node scripts/quick-deploy.mjs [--host=HOST] [--user=USER] [--skip-build] [--tar-only]')
  process.exit(1)
}

const args = process.argv.slice(2)
const host = args.find(a=>a.startsWith('--host='))?.split('=')[1] || process.env.PI_HOST || '192.168.8.10'
const user = args.find(a=>a.startsWith('--user='))?.split('=')[1] || process.env.PI_USER || 'ubuntu'
const skipBuild = args.includes('--skip-build')
const tarOnly = args.includes('--tar-only')
const skipTests = args.includes('--skip-tests')

// assume script is run from repo root
const repoRoot = process.cwd()
const tarName = 'cla_quick.tar'
const tmpRemote = `/tmp/${tarName}`
const CONTAINER = 'claudette'

try{
  if(!skipBuild){
    // build frontend
    if(fs.existsSync(path.join(repoRoot,'package.json'))){
      run('npm', ['run', 'build'])
    }
  }

  // create tar of app files (dist, server, package.json, etc.)
  const include = ['dist','server','package.json','config.yaml','scripts']
    .filter(p=>fs.existsSync(path.join(repoRoot,p)))
  if(include.length===0) throw new Error('Nothing to include in tar')

  const tarPath = path.join(process.cwd(), tarName)
  // remove existing
  try{ fs.unlinkSync(tarPath) }catch(e){}

  // create tar (POSIX tar required)
  run('tar', ['-cf', tarPath, ...include], { cwd: repoRoot })
  console.log('Created', tarPath)

  if(tarOnly){
    console.log('Tar created, exiting (tar-only)')
    process.exit(0)
  }

  // check remote tar mtime (seconds since epoch). If remote is newer or equal, skip upload/deploy.
  let remoteMtime = 0
  try{
    const check = spawnSync('ssh', [`${user}@${host}`, `stat -c %Y ${tmpRemote} 2>/dev/null || echo 0`], { encoding: 'utf8' })
    if(check.status === 0 && check.stdout) remoteMtime = Number(check.stdout.trim()) || 0
  }catch(e){ /* ignore */ }

  const localMtime = Math.floor(fs.statSync(tarPath).mtimeMs / 1000)
  if(localMtime <= remoteMtime){
    console.log('Remote already has same-or-newer tar; skipping upload/deploy')
    process.exit(0)
  }

  // upload via scp
  run('scp', [tarPath, `${user}@${host}:/tmp/`])

  // Remote quick deploy: copy tar into container, extract into /app, restart container
  const remoteQuick = [
    `sudo docker cp ${tmpRemote} ${CONTAINER}:/tmp/cla_quick.tar`,
    `sudo docker exec ${CONTAINER} sh -c 'cd /app && tar xf /tmp/cla_quick.tar && rm -f /tmp/cla_quick.tar'`,
    `sudo docker restart ${CONTAINER}`,
  ].join(' && ')
  run('ssh', [`${user}@${host}`, remoteQuick])

  console.log('Deploy finished. You may need to restart the container or run additional migrate steps on the Pi.')

}catch(err){
  console.error('quick-deploy failed:', err.message)
  process.exit(1)
}

export default null
