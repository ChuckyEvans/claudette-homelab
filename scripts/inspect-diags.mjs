import fs from 'fs'
import path from 'path'
import pkg from 'node-sqlite3-wasm'
import { getDbPath } from '../server/db.js'
const { Database } = pkg

const DB_PATH = getDbPath()
if (!fs.existsSync(DB_PATH)) {
  console.error('DB not found at', DB_PATH)
  process.exit(2)
}
const tmpPath = DB_PATH + '.diag.copy'
try { fs.copyFileSync(DB_PATH, tmpPath) } catch (e) { console.error('[error] copying DB:', e.message); process.exit(2) }
const db = new Database(tmpPath)

function q(sql, params=[]) { try { return db.get(sql, params) } catch (e) { console.error('query error', e); return null } }
function qa(sql, params=[]) { try { return db.all(sql, params) } catch (e) { console.error('query error', e); return [] } }

console.log('DB:', DB_PATH)
const count = q('SELECT COUNT(*) AS n FROM outage_diagnostics')?.n ?? 0
console.log('outage_diagnostics count:', count)
const last = q('SELECT outage_ts, captured_at, outage_type, gateway, rowid FROM outage_diagnostics ORDER BY captured_at DESC LIMIT 1')
if (last) console.log('latest:', { outage_ts: new Date(last.outage_ts).toISOString(), captured_at: new Date(last.captured_at).toISOString(), outage_type: last.outage_type, gateway: last.gateway, rowid: last.rowid })

console.log('\nLast 20 outage_diagnostics:')
const rows = qa('SELECT outage_ts, captured_at, outage_type, gateway, traceroute FROM outage_diagnostics ORDER BY captured_at DESC LIMIT 20')
for (const r of rows) console.log(new Date(r.captured_at).toISOString(), new Date(r.outage_ts).toISOString(), r.outage_type, r.gateway)

// clean up
try { fs.unlinkSync(tmpPath) } catch (e) {}
