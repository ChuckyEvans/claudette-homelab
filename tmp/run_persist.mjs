import('/app/server/db.js').then(m=>m.persistOutages()).then(r=>console.log('OK',r)).catch(e=>{console.error(e && e.stack);process.exit(1)});
