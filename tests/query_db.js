(async ()=>{
  const { getDb } = await import('../server/db.js')
  const db = getDb()
  const r = db.get("SELECT COUNT(*) AS n, MAX(ts) AS mx FROM audit_log WHERE event = 'internet.check'")
  const s = db.get("SELECT COUNT(*) AS n, MAX(ts) AS mx FROM speedtest_results")
  console.log('internet.check:', r)
  console.log('speedtest_results:', s)
})().catch(e=>{ console.error(e); process.exit(1) })

;(async ()=>{
  const { getDb } = await import('../server/db.js')
  const db = getDb()
  console.log('\n--- sample internet.check payloads ---')
  const rows = db.all("SELECT ts, payload FROM audit_log WHERE event = 'internet.check' ORDER BY ts DESC LIMIT 5")
  for (const r of rows) console.log(new Date(r.ts).toISOString(), r.payload)
  console.log('\n--- recent speedtest rows ---')
  const srows = db.all("SELECT ts, ping_ms, download_mbps, upload_mbps, error FROM speedtest_results ORDER BY ts DESC LIMIT 5")
  for (const s of srows) console.log(new Date(s.ts).toISOString(), s.ping_ms, s.download_mbps, s.upload_mbps, s.error)
})().catch(e=>{ console.error(e); process.exit(1) })
