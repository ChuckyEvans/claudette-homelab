const BASE = '/api'

// When the server returns 401 on a protected route, fire a custom event so
// App.jsx can immediately show the login screen — no matter which API call triggered it.
function notifySessionExpired() {
  window.dispatchEvent(new CustomEvent('claudette:session-expired'))
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (res.status === 401 && !path.startsWith('/auth/')) {
    notifySessionExpired()
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10) || null
    const body = await res.json().catch(() => ({ error: 'Too many requests' }))
    const msg = retryAfter
      ? `${body.error || 'Too many requests'} Try again in ${retryAfter}s.`
      : (body.error || 'Too many requests — please wait before retrying.')
    const err = new Error(msg)
    err.status = 429
    err.retryAfter = retryAfter
    throw err
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

export const api = {
  services: {
    get: () => request('/services'),
    history: () => request('/services/history'),
    internet: () => request('/services/internet'),
    run: () => request('/services/run', { method: 'POST' }),
    runInternet: () => request('/services/internet/run', { method: 'POST' }),
  },
  threats: {
    get: () => request('/threats'),
    refresh: () => request('/threats/refresh', { method: 'POST' }),
    run: () => request('/threats/run', { method: 'POST' }),
  },
  network: {
    get: () => request('/network/scan'),
    scan: () => request('/network/scan', { method: 'POST' }),
    cancel: () => request('/network/scan', { method: 'DELETE' }),
    deepScan: () => request('/network/deep-scan', { method: 'POST' }),
    cancelDeepScan: () => request('/network/deep-scan', { method: 'DELETE' }),
    clearAll: () => request('/network/devices', { method: 'DELETE' }),
    clearPorts: (mac) => request(`/network/device/${mac}/ports`, { method: 'DELETE' }),
    device: (ip) => request(`/network/device/${ip}`),
    cancelDeviceScan: (ip) => request(`/network/device/${encodeURIComponent(ip)}/scan`, { method: 'DELETE' }),
    ping: () => request('/network/ping'),
    pingHost: (ip) => request(`/network/ping-host?ip=${encodeURIComponent(ip)}`),
    connections: (ip) => request(`/network/connections/${ip}`),
    myIp: () => request('/network/myip'),
    setLabel: (mac, label) => request(`/network/device/${encodeURIComponent(mac)}/label`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    }),
  },
  system: {
    stats:      () => request('/system/stats'),
    interfaces: () => request('/system/interfaces'),
    version:    (force) => request(`/system/version${force ? '?force=1' : ''}`),  
    backup: async () => {
      const res = await fetch('/api/system/backup', { method: 'POST', credentials: 'include' })
      if (res.status === 401) { notifySessionExpired(); throw new Error('Not authenticated') }
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText) }
      const blob     = await res.blob()
      const cd       = res.headers.get('Content-Disposition') ?? ''
      const match    = cd.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'claudette-backup.claudette'
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
      URL.revokeObjectURL(link.href)
    },
    restore: (fileData) => request('/system/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileData,
    }),
  },
  config: {
    status: () => request('/config/status'),
    get: () => request('/config'),
    save: (data, silent = false) => request(`/config${silent ? '?silent=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
    reset: () => request('/config', { method: 'DELETE' }),
  },
  audit: {
    get: (params = {}) => {
      const q = new URLSearchParams()
      if (params.event)  q.set('event',  params.event)
      if (params.limit)  q.set('limit',  params.limit)
      if (params.offset) q.set('offset', params.offset)
      return request(`/audit?${q}`)
    },
    clear: () => request('/audit', { method: 'DELETE' }),
  },
  reports: {
    get: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from)   q.set('from',   params.from)
      if (params.to)     q.set('to',     params.to)
      if (params.event)  q.set('event',  params.event)
      if (params.mac)    q.set('mac',    params.mac)
      if (params.subnet) q.set('subnet', params.subnet)
      if (params.limit)  q.set('limit',  params.limit)
      if (params.offset) q.set('offset', params.offset)
      return request(`/reports?${q}`)
    },
    devices: () => request('/reports/devices'),
    chart: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from) q.set('from', params.from)
      if (params.to)   q.set('to',   params.to)
      return request(`/reports/chart?${q}`)
    },
    internet: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from)   q.set('from',   params.from)
      if (params.to)     q.set('to',     params.to)
      if (params.limit)  q.set('limit',  params.limit)
      if (params.offset) q.set('offset', params.offset)
      return request(`/reports/internet?${q}`)
    },
    speedtest: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from)   q.set('from',   params.from)
      if (params.to)     q.set('to',     params.to)
      if (params.limit)  q.set('limit',  params.limit)
      if (params.offset) q.set('offset', params.offset)
      return request(`/reports/speedtest?${q}`)
    },
    runSpeedtest: () => request('/reports/speedtest', { method: 'POST' }),
    outages: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from) q.set('from', params.from)
      if (params.to)   q.set('to',   params.to)
      return request(`/reports/outages?${q}`)
    },
  },
  auth: {
    status:   ()     => request('/auth/status'),
    register: (data) => request('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    login:    (data) => request('/auth/login',    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    logout:   ()     => request('/auth/logout',   { method: 'POST' }),
  },
}

export function createEventSource(onEvent) {
  const es = new EventSource('/api/events')
  const events = [
    'services', 'threats', 'scan_complete', 'scan_started', 'scan_error', 'scan_progress',
    'port_scan_progress', 'device_error',
    'deep_scan_started', 'deep_scan_progress', 'deep_scan_complete',
    'internet', 'job_done',
  ]
  for (const ev of events) {
    es.addEventListener(ev, e => onEvent(ev, JSON.parse(e.data)))
  }
  es.addEventListener('speedtest', e => onEvent('speedtest', JSON.parse(e.data)))
  es.onerror = () => console.warn('[SSE] connection lost, will retry')
  return es
}

// Export helper: Generate CSV from array of objects
export function exportToCsv(data, filename = 'export.csv') {
  if (!data || data.length === 0) return
  const headers = Object.keys(data[0])
  const rows = [
    headers.map(h => `"${h}"`).join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h]
      if (val === null || val === undefined) return ''
      if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`
      return `"${String(val).replace(/"/g, '""')}"`
    }).join(',')),
  ]
  const csv = rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

// Export helper: Export report data to PNG (screenshot of a DOM element)
export async function exportToPng(elementId, filename = 'export.png') {
  try {
    const { default: html2canvas } = await import('html2canvas')
    const element = document.getElementById(elementId)
    if (!element) throw new Error(`Element ${elementId} not found`)
    // Temporarily expand overflow so off-screen content is captured
    const prev = element.style.overflow
    element.style.overflow = 'visible'
    const canvas = await html2canvas(element, {
      backgroundColor: '#0a0a18',
      scale: 1,
      useCORS: true,
      scrollY: -window.scrollY,
      windowHeight: element.scrollHeight,
    })
    element.style.overflow = prev
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = filename
    link.click()
  } catch (err) {
    console.error('PNG export failed:', err)
    throw err
  }
}

/**
 * Data-driven PDF export — clean light-background layout for printing / emailing to ISP.
 * @param {object} reportData
 *   rangeLabel, summary, internetStats, outages, ispConfig, daily, topPorts, speedtests, events
 * @param {string} filename
 */
export async function exportToPdf(reportData, filename = 'report.pdf') {
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, M = 15, COL = W - M * 2
  let y = 20

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function checkPage(need = 8) {
    if (y + need > 283) { doc.addPage(); y = 18 }
  }

  function rule(r = 210, g = 215, b = 230, h = 0.3) {
    doc.setDrawColor(r, g, b)
    doc.setLineWidth(h)
    doc.line(M, y, W - M, y)
    y += 4
  }

  function sectionHead(text) {
    checkPage(16)
    y += 3
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(55, 75, 165)
    doc.text(text.toUpperCase(), M, y)
    y += 2
    rule(55, 75, 165, 0.4)
  }

  // Two-column key/value row.  labelW controls where value starts.
  function kv(label, value, labelW = 62) {
    checkPage(6)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(90, 95, 120)
    doc.text(label, M, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(20, 25, 40)
    const lines = doc.splitTextToSize(String(value ?? '—'), COL - labelW - 2)
    doc.text(lines[0] ?? '—', M + labelW, y)
    y += 5.5
  }

  // Table: columns = [{header, key, w}], rows = array of objects.
  // Headers repeat automatically on each new page.
  function table(columns, rows) {
    if (!rows?.length) return
    const rowH = 5.5
    const hdrY = () => y - rowH + 1.5

    const drawHeader = () => {
      checkPage(rowH * 2)
      doc.setFillColor(235, 238, 250)
      doc.rect(M, hdrY(), COL, rowH, 'F')
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(55, 75, 165)
      let x = M + 2
      for (const col of columns) { doc.text(col.header, x, y); x += col.w }
      y += rowH
      rule(180, 190, 220, 0.2)
    }

    drawHeader()
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')

    for (let i = 0; i < rows.length; i++) {
      if (y + rowH > 283) { doc.addPage(); y = 18; drawHeader() }
      if (i % 2 === 1) {
        doc.setFillColor(248, 249, 253)
        doc.rect(M, hdrY(), COL, rowH, 'F')
      }
      doc.setTextColor(20, 25, 40)
      let x = M + 2
      for (const col of columns) {
        const v = String(rows[i][col.key] ?? '')
        // Estimate max chars: helvetica ~1.65mm/char at 8pt
        const maxC = Math.floor(col.w / 1.65)
        doc.text(v.length > maxC ? v.slice(0, maxC - 1) + '…' : v, x, y)
        x += col.w
      }
      y += rowH
    }
    y += 3
  }

  function fmtMsPdf(ms) {
    if (!ms || ms <= 0) return '0s'
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60), rs = s % 60
    if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`
    const h = Math.floor(m / 60), rm = m % 60
    return rm ? `${h}h ${rm}m` : `${h}h`
  }

  // ── Title bar ───────────────────────────────────────────────────────────────
  doc.setFillColor(45, 55, 140)
  doc.rect(0, 0, W, 15, 'F')
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text('Claudette — Network Report', M, 10)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(180, 195, 240)
  const genLine = `${reportData.rangeLabel ?? ''}  ·  Generated ${new Date().toLocaleString('en-GB')}`
  doc.text(genLine, W - M - doc.getTextWidth(genLine), 10)
  y = 22

  // ── ISP / report context ────────────────────────────────────────────────────
  const isp = reportData.ispConfig ?? {}
  if (isp.name || isp.account_number) {
    sectionHead('Report Context')
    if (isp.name)             kv('ISP', `${isp.name}${isp.connection_type ? ` (${isp.connection_type})` : ''}`)
    if (isp.account_number)   kv('Account No', isp.account_number)
    if (isp.support_email)    kv('Support Email', isp.support_email)
    kv('Expected Uptime SLA', `${isp.expected_uptime ?? 100}%`)
    if (isp.plan_download_mbps > 0 || isp.plan_upload_mbps > 0) {
      kv('Speed Plan', [
        isp.plan_download_mbps > 0 ? `${isp.plan_download_mbps} Mbps download` : '',
        isp.plan_upload_mbps   > 0 ? `${isp.plan_upload_mbps} Mbps upload`     : '',
      ].filter(Boolean).join(' / '))
    }
    y += 2
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const s = reportData.summary ?? {}
  sectionHead('Event Summary')
  const summaryPairs = [
    ['New Devices',    s.newDevices  ?? 0, 'Online Events',  s.onlineEvents  ?? 0],
    ['Offline Events', s.offlineEvents ?? 0, 'Ports Found', s.portFinds     ?? 0],
    ['Service Outages',s.serviceDown ?? 0, 'Scans Run',     s.scansRun      ?? 0],
  ]
  for (const [lA, vA, lB, vB] of summaryPairs) {
    checkPage(6)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 95, 120)
    doc.text(lA, M, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 25, 40)
    doc.text(String(vA), M + 50, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 95, 120)
    doc.text(lB, M + 95, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 25, 40)
    doc.text(String(vB), M + 145, y)
    y += 5.5
  }
  y += 2

  // ── Internet Connectivity ───────────────────────────────────────────────────
  if (reportData.internetStats) {
    const is = reportData.internetStats
    const uptimeOk = parseFloat(is.uptime) >= 100
    sectionHead('Internet Connectivity')
    checkPage(6)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 95, 120)
    doc.text('Uptime', M, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(uptimeOk ? 30 : 190, uptimeOk ? 150 : 40, uptimeOk ? 80 : 40)
    const uptimeNote = uptimeOk ? '' : `  ⚠ Below ${isp.expected_uptime ?? 100}% SLA${isp.name ? ` — ${isp.name}` : ''}`
    doc.text(`${is.uptime}%${uptimeNote}`, M + 62, y)
    y += 5.5
    kv('Avg Latency', `${is.avgLatency} ms`)
    kv('Total Checks', is.totalChecks)
    kv('Status Changes', is.changes)
    y += 2
  }

  // ── Outage Log ──────────────────────────────────────────────────────────────
  if (reportData.outages?.totalOutages > 0) {
    sectionHead('Internet Outage Log')
    kv('Total incidents',   reportData.outages.totalOutages)
    kv('Total downtime',    fmtMsPdf(reportData.outages.totalDowntimeMs))
    kv('Longest incident',  fmtMsPdf(reportData.outages.longestMs))
    y += 2
    table(
      [
        { header: '#',        key: 'num',   w: 10 },
        { header: 'Start',    key: 'start', w: 55 },
        { header: 'End',      key: 'end',   w: 55 },
        { header: 'Duration', key: 'dur',   w: 35 },
        { header: 'Was Up',   key: 'before',w: 25 },
      ],
      reportData.outages.outages.map((o, i) => ({
        num:    String(i + 1),
        start:  new Date(o.start).toLocaleString('en-GB'),
        end:    o.ongoing ? 'STILL OFFLINE' : new Date(o.end).toLocaleString('en-GB'),
        dur:    fmtMsPdf(o.durationMs) + (o.ongoing ? '+' : ''),
        before: o.uptimeBeforeMs != null ? fmtMsPdf(o.uptimeBeforeMs) : '—',
      }))
    )
    y += 2
  }

  // ── Speed Test vs SLA ────────────────────────────────────────────────────────
  if (reportData.speedtests?.length) {
    const planDown = isp.plan_download_mbps ?? 0
    const planUp   = isp.plan_upload_mbps   ?? 0
    if (planDown > 0 || planUp > 0) {
      const sRows = reportData.speedtests
      const aDown = (sRows.reduce((t, r) => t + (r.download_mbps ?? 0), 0) / sRows.length).toFixed(1)
      const aUp   = (sRows.reduce((t, r) => t + (r.upload_mbps   ?? 0), 0) / sRows.length).toFixed(1)
      const bDown = planDown > 0 ? sRows.filter(r => (r.download_mbps ?? 0) < planDown * 0.8).length : 0
      const bUp   = planUp   > 0 ? sRows.filter(r => (r.upload_mbps   ?? 0) < planUp   * 0.8).length : 0
      const wDown = sRows.reduce((mn, r) => Math.min(mn, r.download_mbps ?? Infinity), Infinity)
      const wUp   = sRows.reduce((mn, r) => Math.min(mn, r.upload_mbps   ?? Infinity), Infinity)
      sectionHead('Speed Test vs SLA')
      kv('Tests in period',       sRows.length)
      if (planDown > 0) kv('Average download', `${aDown} Mbps  (${Math.round(parseFloat(aDown) / planDown * 100)}% of ${planDown} Mbps plan)`)
      if (planUp   > 0) kv('Average upload',   `${aUp} Mbps  (${Math.round(parseFloat(aUp)   / planUp   * 100)}% of ${planUp} Mbps plan)`)
      if (planDown > 0) kv('Below 80% DL SLA', `${bDown} / ${sRows.length} tests  ${bDown > 0 ? '[SLA BREACH]' : '[OK]'}`)
      if (planUp   > 0) kv('Below 80% UL SLA', `${bUp} / ${sRows.length} tests  ${bUp   > 0 ? '[SLA BREACH]' : '[OK]'}`)
      if (planDown > 0 && wDown !== Infinity) kv('Worst download', `${wDown} Mbps  (${Math.round(wDown / planDown * 100)}% of plan)`)
      if (planUp   > 0 && wUp   !== Infinity) kv('Worst upload',   `${wUp} Mbps  (${Math.round(wUp   / planUp   * 100)}% of plan)`)
      y += 2
    }
  }

  // ── Activity Timeline ───────────────────────────────────────────────────────
  if (reportData.daily?.length) {
    sectionHead('Activity Timeline')
    table(
      [
        { header: 'Date',    key: 'date',    w: 38 },
        { header: 'New',     key: 'new',     w: 28 },
        { header: 'Online',  key: 'online',  w: 32 },
        { header: 'Offline', key: 'offline', w: 32 },
        { header: 'Ports',   key: 'ports',   w: 28 },
      ],
      reportData.daily
    )
  }

  // ── Top Ports ───────────────────────────────────────────────────────────────
  if (reportData.topPorts?.length) {
    sectionHead('Top Ports Discovered')
    table(
      [{ header: 'Port', key: 'port', w: 50 }, { header: 'Finds', key: 'count', w: 50 }],
      reportData.topPorts
    )
  }

  // ── Speed Test History ───────────────────────────────────────────────────────
  if (reportData.speedtests?.length) {
    const planDown = isp.plan_download_mbps ?? 0
    const planUp   = isp.plan_upload_mbps   ?? 0
    const hasPlan  = planDown > 0 || planUp > 0
    sectionHead('Speed Test History')
    table(
      [
        { header: 'Date',       key: 'ts',       w: 35 },
        { header: 'Download',   key: 'download', w: 35 },
        { header: 'Upload',     key: 'upload',   w: 30 },
        ...(hasPlan ? [{ header: 'vs Plan', key: 'plan', w: 28 }] : []),
        { header: 'Latency',    key: 'latency',  w: 22 },
        { header: 'Server',     key: 'server',   w: hasPlan ? 30 : 58 },
      ],
      reportData.speedtests.slice(0, 50).map(r => ({
        ts:       new Date(r.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        download: r.download_mbps != null ? `${r.download_mbps} Mbps` : '—',
        upload:   r.upload_mbps   != null ? `${r.upload_mbps} Mbps`   : '—',
        plan: (() => {
          const parts = []
          if (planDown > 0 && r.download_mbps != null) parts.push(`↓${Math.round(r.download_mbps / planDown * 100)}%`)
          if (planUp   > 0 && r.upload_mbps   != null) parts.push(`↑${Math.round(r.upload_mbps   / planUp   * 100)}%`)
          return parts.join(' ') || '—'
        })(),
        latency:  r.ping_ms       != null ? `${r.ping_ms} ms`         : '—',
        server:   r.server_name   ?? r.server_host ?? '—',
      }))
    )
  }

  // ── Recent Events ───────────────────────────────────────────────────────────
  if (reportData.events?.length) {
    sectionHead('Recent Events')
    table(
      [
        { header: 'Time',   key: 'ts',     w: 40 },
        { header: 'Event',  key: 'event',  w: 52 },
        { header: 'Device', key: 'device', w: 55 },
        { header: 'Src',    key: 'source', w: 18 },
      ],
      reportData.events.slice(0, 60).map(e => ({
        ts:     new Date(e.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        event:  e.event,
        device: e.hostname || e.ip || '',
        source: e.source,
      }))
    )
  }

  // ── Footer on each page ─────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(160, 165, 185)
    doc.text('Generated by Claudette Network Monitor', M, 291)
    doc.text(`Page ${i} of ${pageCount}`, W - M - 20, 291)
  }

  doc.save(filename)
}
