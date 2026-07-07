#!/usr/bin/env node
import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

function pad(n){return String(n).padStart(2,'0')}

function utcTimestamp(){
  const d = new Date()
  const Y = d.getUTCFullYear()
  const M = pad(d.getUTCMonth()+1)
  const D = pad(d.getUTCDate())
  const h = pad(d.getUTCHours())
  const m = pad(d.getUTCMinutes())
  const s = pad(d.getUTCSeconds())
  return `${Y}_${M}_${D}_${h}_${m}_${s}`
}

async function main(){
  const argv = process.argv.slice(2)
  const dbPath = argv[0] || process.env.CLAU_DB || 'data/claudette.db'
  const outDir = argv[1] || process.env.CLAU_BACKUP_DIR || 'output/claudette-db-backups'
  const retain = Number(argv.find(a=>a.startsWith('--retain='))?.split('=')[1] || process.env.CLAU_BACKUP_RETAIN || 10)

  if(!existsSync(dbPath)){
    console.error('DB not found:', dbPath)
    process.exit(2)
  }

  await fs.mkdir(outDir, { recursive: true })

  const ts = utcTimestamp()
  // filename format: clauddette_YYYY_MM_DD_hh_mm_ss.db
  const base = path.basename(dbPath)
  const name = base.replace(/\.db$/,'') || 'claudette'
  const outName = `${name}_${ts}.db`
  const outPath = path.join(outDir, outName)

  // copy file (atomic on POSIX when moving temporary file)
  const tmpPath = outPath + '.tmp'
  try{
    await fs.copyFile(dbPath, tmpPath)
    await fs.rename(tmpPath, outPath)
    // update latest symlink (if supported) or copy to latest file
    const latestLink = path.join(outDir, `${name}_latest.db`)
    try{
      // remove existing file/link
      if(existsSync(latestLink)) await fs.unlink(latestLink)
      await fs.symlink(outName, latestLink)
    }catch(e){
      // fallback: copy to latest
      await fs.copyFile(outPath, latestLink)
    }
    console.log('Backup created:', outPath)

    // prune old backups
    const files = await fs.readdir(outDir)
    const backups = files.filter(f=>f.startsWith(name+'_') && f.endsWith('.db') && !f.endsWith('_latest.db'))
      .map(f=>({f,stat:fs.stat(path.join(outDir,f))}))

    const resolved = []
    for(const it of backups){
      const st = await it.stat
      resolved.push({file: it.f, mtime: st.mtimeMs})
    }
    resolved.sort((a,b)=>b.mtime - a.mtime)
    if(resolved.length > retain){
      const toDelete = resolved.slice(retain)
      for(const d of toDelete){
        const p = path.join(outDir, d.file)
        await fs.unlink(p)
        console.log('Pruned:', p)
      }
    }

  }catch(err){
    console.error('Backup failed:', err)
    try{ await fs.unlink(tmpPath) }catch(e){}
    process.exit(1)
  }
}

if(import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('backup.mjs')){
  main()
}

export default main
