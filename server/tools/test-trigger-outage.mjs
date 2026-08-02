#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(__dirname, '..', '..', 'data')
const CFG = path.join(DATA, 'config.yaml')
const BAK = path.join('/tmp', `config.yaml.bak.${Date.now()}`)

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)) }

async function main(){
  try{
    if (!fs.existsSync(CFG)) console.error('[test] config.yaml not found at', CFG)
    fs.copyFileSync(CFG, BAK)
    console.log('[test] Backed up config to', BAK)
    const override = `network:\n  connectivity_hosts:\n    - 10.255.255.1\n  http_connectivity_check_url: ''\nschedule:\n  outage_double_check_attempts: 1\n  outage_double_check_interval_seconds: 1\n`
    fs.writeFileSync(CFG, override)
    console.log('[test] Wrote override config to force outage')

    // Import services and trigger a check
    const services = await import('../routes/services.js')
    console.log('[test] Running checkConnectivity()')
    await services.checkConnectivity(null)
    console.log('[test] checkConnectivity completed — waiting 20s for background mtr to finish')
    await sleep(20000)

    // Inspect DB for latest diagnostics
    const dbmod = await import('../db.js')
    const db = dbmod.getDb()
    const row = db.get('SELECT outage_ts, traceroute_last_hop, substr(traceroute,1,400) as tracer_sample FROM outage_diagnostics ORDER BY outage_ts DESC LIMIT 1')
    console.log('[test] Latest outage_diagnostics row:', row)
  } catch (e) { console.error('[test] error', e && e.message) }
  finally {
    // Restore config
    try { if (fs.existsSync(BAK)) { fs.copyFileSync(BAK, CFG); console.log('[test] Restored original config') } } catch(e){ console.error('[test] restore failed', e && e.message) }
    process.exit(0)
  }
}

main()
