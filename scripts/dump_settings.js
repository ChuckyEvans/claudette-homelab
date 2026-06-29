(async function(){
  try{
    const fs = await import('fs')
    try{
      const state = fs.readFileSync('/app/data/state.json','utf8')
      console.log('--- state.json ---')
      console.log(state)
    }catch(e){console.log('state.json not found or unreadable')}
    try{
      const db=(await import('../server/db.js')).getDb()
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      console.log('--- tables ---')
      console.log(tables.map(r=>r.name).join(', '))
      const rows = db.prepare("SELECT name, value FROM settings LIMIT 20").all()
      console.log('--- settings (first 20) ---')
      console.log(JSON.stringify(rows,null,2))
    }catch(e){console.error('db query failed', e.message)}
  }catch(e){console.error('error',e.message)}
})()
