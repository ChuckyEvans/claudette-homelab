(async function(){
  try {
    const url = 'http://192.168.8.10:7654/api/reports/debug/outages'
    const r = await fetch(url)
    const j = await r.json()
    console.log('totalOutages', j.totalOutages, 'totalDowntimeMs', j.totalDowntimeMs, 'longestMs', j.longestMs)
    console.log('persisted', (j.persisted||[]).length, 'checks', (j.checks||[]).length, 'paired', (j.pairedFromChecks||[]).length)
    console.log('persisted last 5:', JSON.stringify((j.persisted||[]).slice(-5), null, 2))
    console.log('paired last 5:', JSON.stringify((j.pairedFromChecks||[]).slice(-5), null, 2))
  } catch (e) { console.error(e && e.stack || e) }
})()
