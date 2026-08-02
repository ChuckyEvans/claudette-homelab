import fs from 'fs'
import path from 'path'
// Backfill outages tool
// Usage:
//   node server/tools/backfill-outages.mjs [--dry-run] [--yes] [--all] [--from=ISO|ms] [--to=ISO|ms] [--days=N]
// Examples:
//   node server/tools/backfill-outages.mjs --all --yes
//   node server/tools/backfill-outages.mjs --days=90 --yes

async function dynamicImportDbWithRetry(maxAttempts = 6, waitMs = 200) {
  let attempt = 0
  while (true) {
    try {
      const mod = await import('../db.js')
      return mod
    } catch (e) {
      attempt++
      const msg = e && e.message ? e.message : String(e)
      if (attempt >= maxAttempts) throw e
      console.warn(`[backfill] DB import failed (attempt ${attempt}/${maxAttempts}): ${msg}. Retrying in ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
      waitMs = Math.min(waitMs * 2, 5000)
    }
  }
}
async function getDbWithRetry(dbMod, maxAttempts = 6, waitMs = 200) {
  let attempt = 0
  while (true) {
    try {
      return dbMod.getDb()
    } catch (e) {
      attempt++
      const msg = e && e.message ? e.message : String(e)
      if (attempt >= maxAttempts) throw e
      console.warn(`[backfill] getDb failed (attempt ${attempt}/${maxAttempts}): ${msg}. Retrying in ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
      waitMs = Math.min(waitMs * 2, 5000)
    }
  }
}
function parseTime(v) {
  if (!v) return null
  if (/^\d+$/.test(String(v))) return Number(v)
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const autoYes = argv.includes('--yes')
const all = argv.includes('--all')

const opts = {}
for (const a of argv) {
  if (a.startsWith('--from=')) opts.from = parseTime(a.split('=')[1])
  else if (a.startsWith('--to=')) opts.to = parseTime(a.split('=')[1])
  else if (a.startsWith('--days=')) opts.days = Math.max(1, parseInt(a.split('=')[1]) || 0)
}

const now = Date.now()
let from = opts.from ?? null
let to = opts.to ?? now
if (!from && opts.days) from = now - opts.days * 24 * 3600 * 1000
if (!from && !all && !opts.days) from = now - 90 * 24 * 3600 * 1000 // default 90 days

if (all && !autoYes) {
  console.error('Refusing to backfill entire history without --yes. Use --all --yes to proceed.')
  process.exit(2)
}

console.log('[backfill] plan:', { from: from ? new Date(from).toISOString() : null, to: new Date(to).toISOString(), all })

function backupTable(db, table) {
  const rows = db.all(`SELECT * FROM ${table} ORDER BY ROWID ASC`)
  const dir = path.resolve(process.cwd(), 'tmp_backups')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const fn = path.join(dir, `${table.replace(/[^a-z0-9_]/g, '_')}-${Date.now()}.json`)
  fs.writeFileSync(fn, JSON.stringify(rows, null, 2), 'utf8')
  return fn
}

async function callDbOp(fn, maxAttempts = 6, waitMs = 200) {
  let attempt = 0
  while (true) {
    try {
      return fn()
    } catch (e) {
      attempt++
      const msg = e && e.message ? e.message : String(e)
      if (attempt >= maxAttempts) throw e
      console.warn(`[backfill] DB op failed (attempt ${attempt}/${maxAttempts}): ${msg}. Retrying in ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
      waitMs = Math.min(waitMs * 2, 5000)
    }
  }
}

try {
  const dbMod = await dynamicImportDbWithRetry()
  const { getDb, persistOutages, persistTargetOutages } = dbMod
  const db = await getDbWithRetry(dbMod)
  const beforeNet = await callDbOp(() => db.get('SELECT COUNT(*) as c FROM network_outages'))
  const beforeTarget = await callDbOp(() => db.get('SELECT COUNT(*) as c FROM target_outages'))
  console.log(`[backfill] current counts: network_outages=${beforeNet.c}, target_outages=${beforeTarget.c}`)

  if (dryRun) console.log('[backfill] dry-run: no changes will be written')

  if (!dryRun) {
    console.log('[backfill] creating backups of existing outage tables...')
    const b1 = await callDbOp(() => backupTable(db, 'network_outages'))
    const b2 = await callDbOp(() => backupTable(db, 'target_outages'))
    console.log('[backfill] backups saved:', b1, b2)
  }

  // Delete rows
  if (!dryRun) {
    if (all) {
      console.log('[backfill] deleting ALL rows from network_outages and target_outages')
      await callDbOp(() => db.run('DELETE FROM network_outages'))
      await callDbOp(() => db.run('DELETE FROM target_outages'))
    } else {
      console.log('[backfill] deleting rows in range from network_outages and target_outages')
      await callDbOp(() => db.run('DELETE FROM network_outages WHERE start >= ? AND start <= ?', [from, to]))
      await callDbOp(() => db.run('DELETE FROM target_outages WHERE start >= ? AND start <= ?', [from, to]))
    }
  } else {
    console.log('[backfill] (dry-run) would delete rows in range or all depending on flags')
  }

  // Recompute
  if (!dryRun) {
    console.log('[backfill] recomputing per-target outages...')
    const t = await callDbOp(() => persistTargetOutages())
    console.log('[backfill] persistTargetOutages wrote', t, 'rows')

    console.log('[backfill] recomputing network outages...')
    const n = await callDbOp(() => persistOutages())
    console.log('[backfill] persistOutages wrote', n, 'rows')
  } else {
    console.log('[backfill] (dry-run) would call persistTargetOutages() and persistOutages()')
  }

  const afterNet = await callDbOp(() => db.get('SELECT COUNT(*) as c FROM network_outages'))
  const afterTarget = await callDbOp(() => db.get('SELECT COUNT(*) as c FROM target_outages'))
  console.log(`[backfill] after counts: network_outages=${afterNet.c}, target_outages=${afterTarget.c}`)
  console.log('[backfill] done')
} catch (e) {
  console.error('[backfill] failed:', e && e.stack)
  process.exit(1)
}
