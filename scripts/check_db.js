(async function(){
  try{
    const db=(await import('../server/db.js')).getDb()
    console.log('--- tables ---')
    console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name).join(', '))
    try{
      console.log('--- settings ---')
      console.log(JSON.stringify(db.prepare("SELECT * FROM settings LIMIT 50").all(),null,2))
    }catch(e){console.log('no settings table or query failed', e.message)}
    try{
      console.log('--- outage_diagnostics (last 10) ---')
      console.log(JSON.stringify(db.prepare("SELECT rowid,outage_ts,outage_type,captured_at FROM outage_diagnostics ORDER BY rowid DESC LIMIT 10").all(),null,2))
    }catch(e){console.log('no outage_diagnostics table or query failed', e.message)}
  }catch(e){console.error('error', e.message)}
})()
