(async function(){
  try{
    const db=(await import('/server/db.js')).getDb()
    const rows=db.prepare('SELECT rowid,outage_ts,outage_type,captured_at,meta FROM outage_diagnostics ORDER BY rowid DESC LIMIT 10').all()
    console.log(JSON.stringify(rows,null,2))
  }catch(e){
    console.error('err',e&&e.message?e.message:e)
    process.exit(1)
  }
})()
