(async function(){
  try{
    const fs=await import('fs')
    const state=fs.readFileSync('/app/data/state.json','utf8')
    const db=(await import('/app/server/db.js')).getDb()
    // create settings if missing
    db.prepare("CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT)").run()
    // upsert state_json
    const up=db.prepare("INSERT INTO settings (name,value) VALUES ('state_json',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value")
    up.run(state)
    console.log('inserted state_json into settings')
    const row=db.prepare("SELECT * FROM settings WHERE name='state_json'").get()
    console.log(row)
  }catch(e){console.error('error',e.message)}
})()
