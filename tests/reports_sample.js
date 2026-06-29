(async ()=>{
  const { getDb } = await import('../server/db.js')
  const { getSpeedTestHistory } = await import('../server/utils/speedtest.js')
  const db = getDb()
  const now = Date.now()
  const from = now - 7*24*60*60*1000

  // chart.daily (use daily_event_summary fallback)
  let summaryRows = []
  try {
    summaryRows = db.all(`SELECT day, new_devices, online_events, offline_events, port_finds FROM daily_event_summary WHERE day >= ? ORDER BY day ASC`, [new Date(from).toISOString().slice(0,10)])
  } catch {
    // Fallback: aggregate from device_events
    const devRows = db.all(`SELECT ts, event FROM device_events WHERE ts >= ? AND ts <= ?`, [from, now])
    const byDay = new Map()
    for (const r of devRows) {
      const d = new Date(r.ts)
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      if (!byDay.has(key)) byDay.set(key, { date: key, new: 0, online: 0, offline: 0, ports: 0 })
      const day = byDay.get(key)
      if      (r.event === 'device.new')        day.new++
      else if (r.event === 'device.online')     day.online++
      else if (r.event === 'device.offline')    day.offline++
      else if (r.event === 'device.port.open')  day.ports++
    }
    summaryRows = Array.from(byDay.values()).sort((a,b)=>a.date.localeCompare(b.date))
  }
  console.log('chart.daily sample:', summaryRows.slice(-5))

  // internet endpoint
  const netRows = db.all(`SELECT ts, payload FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check' ORDER BY ts DESC LIMIT 300`, [from, now])
  netRows.reverse()
  const internet = netRows.flatMap(r => {
    try {
      const p = JSON.parse(r.payload)
      const ok = (p.results ?? []).filter(x => x.ok && x.ms != null)
      const ms = ok.length ? Math.round(ok.reduce((s, x) => s + x.ms, 0) / ok.length) : null
      const vpnOk = (p.vpn_results ?? []).filter(x => x.ok && x.ms != null)
      const vpn_ms = p.vpn_up && vpnOk.length ? Math.round(vpnOk.reduce((s, x) => s + x.ms, 0) / vpnOk.length) : null
      return [{ ts: r.ts, ok: p.ok ?? false, ms, vpn_ms }]
    } catch { return [] }
  })
  console.log('internet sample (first 5):', internet.slice(0,5))

  // internet stats
  const tc = db.get(`SELECT COUNT(*) AS total_checks, SUM(CASE WHEN json_extract(payload,'$.ok') = 1 THEN 1 ELSE 0 END) AS ok_checks FROM audit_log WHERE ts >= ? AND ts <= ? AND event = 'internet.check'`, [from, now])
  console.log('internetStats:', tc)

  // speedtest
  const st = getSpeedTestHistory(from, now, 10, 0)
  console.log('speedtest results sample:', st.rows.slice(0,5))
})().catch(e=>{ console.error(e); process.exit(1) })
