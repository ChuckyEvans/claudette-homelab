import request from 'supertest'
import app from '../server/index.js'

;(async ()=>{
  const res = await request(app).get('/api/reports/outages').expect(200)
  console.log('API /api/reports/outages response:')
  console.log(JSON.stringify(res.body, null, 2))
})().catch(e=>{ console.error(e); process.exit(1) })
