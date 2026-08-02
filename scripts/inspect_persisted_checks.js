(async()=>{
  try{
    const url = 'http://192.168.8.10:7654/api/reports/debug/outages'
    const r = await fetch(url)
    const j = await r.json()
    const persisted = j.persisted || []
    const checks = j.checks || []
    const last = persisted.slice(-5)
    for(const p of last){
      console.log('\nPersisted start:', new Date(p.start).toISOString(), 'end:', p.end?new Date(p.end).toISOString():null, 'duration_ms', p.duration_ms)
      const near = checks.filter(c => Math.abs(c.ts - p.start) < 5*60*1000) // within 5m
      console.log('  matching checks within 5m:', near.length)
      console.log('  sample checks:')
      console.log(JSON.stringify(near.slice(0,5), null, 2))
    }
  }catch(e){ console.error(e && e.stack || e) }
})()
