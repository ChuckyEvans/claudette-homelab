import { spawn } from 'node:child_process'
import { audit } from '../db.js'

const TARGETS = [ '1.1.1.1', '8.8.8.8', 'google.co.za', 'google.com' ]
const TUN_IF = 'tun0'
let _prevNetworkOutage = null

function pingIface(iface, target, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const args = ['-I', iface, '-c', '2', '-W', Math.ceil(timeoutMs/1000), target]
    const p = spawn('ping', args)
    let timed = false
    const to = setTimeout(() => { timed = true; try { p.kill() } catch {} }, timeoutMs)
    p.on('close', (code) => {
      clearTimeout(to)
      if (timed) return resolve(false)
      resolve(code === 0)
    })
    p.on('error', () => { clearTimeout(to); resolve(false) })
  })
}

export async function persistNetworkCheck() {
  try {
    // detect default iface via route (best-effort)
    const defIface = await new Promise((res) => {
      const p = spawn('sh', ['-c', "ip route get 8.8.8.8 2>/dev/null | awk '/dev/ { for(i=1;i<=NF;i++){ if($i==\"dev\") print $(i+1) } }' | head -1"], { stdio: ['ignore','pipe','ignore'] })
      let out = ''
      p.stdout.on('data', b => out += b.toString())
      p.on('close', () => res((out||'').trim() || null))
      p.on('error', () => res(null))
    })

    const iface = defIface || 'eth0'
    const results = []
    let outage = false
    for (const t of TARGETS) {
      const okDirect = await pingIface(iface, t).catch(() => false)
      const okTun = await pingIface(TUN_IF, t).catch(() => false)
      results.push({ target: t, direct: okDirect, tun: okTun })
      if (!okDirect && !okTun) outage = true
    }
    const nowTs = Date.now()
    const payload = { ts: nowTs, iface, results, outage }
    audit('network.check', payload, 'system', null)
    if (outage) audit('network.outage', payload, 'system', null)

    // Emit internet.down/up audit events on transition so outages are paired
    try {
      if (_prevNetworkOutage === null) {
        // initialize from current state but do not emit on first run
        _prevNetworkOutage = outage
      } else if (outage && !_prevNetworkOutage) {
        // transitioned to outage
        audit('internet.down', { detected_at: nowTs, iface, results, outage_type: null }, 'system', null)
        _prevNetworkOutage = true
      } else if (!outage && _prevNetworkOutage) {
        // transitioned back to ok
        audit('internet.up', { detected_at: nowTs, iface, results }, 'system', null)
        _prevNetworkOutage = false
      }
    } catch (e) {
      audit('network.check.audit.transition.error', { message: e.message, stack: e.stack }, 'system', null)
    }

    // Persist into network_check_runs + network_checks
    try {
      const db = (await import('../db.js')).getDb()
      const now = Date.now()
      db.run('INSERT INTO network_check_runs (ts, iface, total_targets, total_outages) VALUES (?, ?, ?, ?)', [
        now,
        iface,
        results.length,
        results.filter(r => !r.direct && !r.tun).length,
      ])
      const runId = db.get('SELECT last_insert_rowid() as id').id
      for (const r of results) {
        db.run('INSERT INTO network_checks (run_id, target, direct_ok, tun_ok, outage) VALUES (?, ?, ?, ?, ?)', [
          runId,
          r.target,
          r.direct ? 1 : 0,
          r.tun ? 1 : 0,
          (!r.direct && !r.tun) ? 1 : 0,
        ])
      }
    } catch (e) {
      audit('network.check.persist.error', { message: e.message, stack: e.stack }, 'system', null)
    }

    return payload
  } catch (e) {
    audit('network.check.error', { message: e.message, stack: e.stack }, 'system', null)
    return null
  }
}

export default { persistNetworkCheck }
