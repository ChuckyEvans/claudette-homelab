import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

function loadConfig() {
  const candidates = [
    '/app/data/config.yaml',
    path.join(process.cwd(), 'config.yaml'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return yaml.load(fs.readFileSync(p, 'utf8'))
  }
  return null
}

const cfg = loadConfig()
const dbPath = (cfg && cfg.dbPath) ? cfg.dbPath : path.join(process.cwd(), 'data', 'claudette.db')
if (!fs.existsSync(dbPath)) {
  console.error(`[backup] DB not found at ${dbPath}`)
  process.exit(2)
}

const outDir = path.join(process.cwd(), 'output', 'claudette-db-backups')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const base = path.basename(dbPath)
const dest = path.join(outDir, `${base}.${ts}`)
fs.copyFileSync(dbPath, dest)
console.log(`[backup] Copied ${dbPath} -> ${dest}`)
process.exit(0)
