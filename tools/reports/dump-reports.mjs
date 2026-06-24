import puppeteer from 'puppeteer'
import { writeFileSync } from 'fs'

async function run(url, user, pass) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] })
  const page = await browser.newPage()
  await page.goto(url.replace(/\/reports.*$/, '/login'), { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForSelector('input', { timeout: 10000 }).catch(()=>{})
  const inputs = await page.$$('input')
  if (inputs.length >= 2) {
    await inputs[0].focus(); await page.keyboard.type(user, { delay: 30 })
    await inputs[1].focus(); await page.keyboard.type(pass, { delay: 30 })
  } else {
    await page.type('input[name="username"]', user).catch(()=>{})
    await page.type('input[name="password"]', pass).catch(()=>{})
  }
  await page.evaluate(()=>{ const btn = Array.from(document.querySelectorAll('button')).find(b => /sign in|login|submit/i.test(b.textContent||'')); if (btn) btn.click(); })
  await new Promise(r => setTimeout(r, 1500))

  // endpoints to fetch
  const endpoints = [
    '/api/reports?limit=50',
    '/api/reports/chart',
    '/api/reports/internet?limit=100',
    '/api/reports/speedtest?limit=200',
    '/api/reports/outages',
    '/api/reports/devices',
  ]
  for (const ep of endpoints) {
    const res = await page.evaluate(async (ep) => {
      const r = await fetch(ep, { credentials: 'include' })
      const txt = await r.text()
      return { status: r.status, body: txt }
    }, ep)
    const name = ep.replace(/[^a-z0-9]/gi, '_') + '.json'
    writeFileSync(name, JSON.stringify(res, null, 2))
    console.log('Saved', name)
  }

  await browser.close()
}

if (process.argv.length < 5) {
  console.error('Usage: node dump-reports.mjs <baseUrl> <user> <pass>')
  process.exit(2)
}
run(process.argv[2], process.argv[3], process.argv[4]).catch(e => { console.error(e); process.exit(1) })
