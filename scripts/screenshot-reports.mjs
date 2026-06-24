import puppeteer from 'puppeteer';

(async () => {
  const url = process.argv[2] || 'http://192.168.8.10:7654/reports';
  const username = process.argv[3]
  const password = process.argv[4]
  const browser = await puppeteer.launch({args: ['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push({type: msg.type(), text: msg.text()}));
  page.on('pageerror', err => logs.push({type: 'pageerror', text: err.message}));
  page.on('response', resp => {
    const url = resp.url();
    const status = resp.status();
    if (url.includes('/api/reports') || status >= 400) logs.push({type: 'response', url, status});
  });
  await page.setViewport({ width: 1600, height: 900 });
  // If credentials provided, navigate to sign-in, submit, then go to reports
  if (username && password) {
    await page.goto('http://192.168.8.10:7654/login', { waitUntil: 'networkidle0', timeout: 30000 });
    // Wait for the SPA to render inputs
    await page.waitForSelector('input', { timeout: 10000 }).catch(()=>{});
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].focus();
      await page.keyboard.type(username, { delay: 30 });
      await inputs[1].focus();
      await page.keyboard.type(password, { delay: 30 });
    } else {
      // fallback: try named selectors
      await page.type('input[name="username"]', username).catch(()=>{});
      await page.type('input[name="password"]', password).catch(()=>{});
    }
    // click the primary button (matching text) via evaluating
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1500));
  }

  // Force client-side route to the reports path to ensure SPA shows Reports
  await page.evaluate(() => { try { window.history.pushState({}, '', '/reports'); } catch(e){}; try { window.location.pathname = '/reports'; } catch(e){} });
  // Repeatedly click the sidebar Reports entry until the Reports heading appears
  const start = Date.now();
  const timeout = 20000;
  while (Date.now() - start < timeout) {
    try {
      // try to click menu entry
      await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('*')).filter(n => (n.textContent||'').trim() === 'Reports');
        for (const n of nodes) {
          let el = n;
          while (el && el !== document.body) {
            if (el.tagName === 'A' || el.tagName === 'BUTTON' || (el.getAttribute && el.getAttribute('role') === 'button')) { el.click(); return }
            el = el.parentNode;
          }
        }
        const fuzzy = Array.from(document.querySelectorAll('a,button')).find(el => /reports/i.test(el.textContent||''));
        if (fuzzy) fuzzy.click();
      });
    } catch(e) {
      // ignore transient errors from navigation
    }
    // check for heading
    const hasHeading = await page.evaluate(() => Array.from(document.querySelectorAll('h1,h2,h3')).some(h => (h.textContent||'').trim() === 'Reports')).catch(()=>false);
    if (hasHeading) break;
    await new Promise(r => setTimeout(r, 500));
  }
  // wait for Reports heading and reports table to render
  const waitForReports = async () => {
    // wait for heading with exact text 'Reports'
    const hasHeading = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('h1,h2,h3')).some(h => (h.textContent||'').trim() === 'Reports');
    });
    if (!hasHeading) {
      await page.waitForSelector('h1,h2,h3', { timeout: 15000 }).catch(()=>{});
    }
    // wait for table or reports wrapper
    await page.waitForSelector('.reports-table, .reports-table-wrapper, #reports-root table', { timeout: 20000 }).catch(()=>{});
  }
  await waitForReports();
  // wait a bit for dynamic content
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'reports-screenshot.png', fullPage: true });
  // write diagnostics
  const { writeFileSync } = await import('node:fs');
  writeFileSync('reports-diagnostics.json', JSON.stringify({ url, logs }, null, 2));
  console.log('Screenshot saved: reports-screenshot.png');
  await browser.close();
})();
