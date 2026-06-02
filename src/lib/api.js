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
    vpnMeta: () => request('/services/vpn-meta'),
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
    toggleFavorite: (mac) => request(`/network/device/${encodeURIComponent(mac)}/favorite`, { method: 'POST' }),
    toggleFlagged:  (mac) => request(`/network/device/${encodeURIComponent(mac)}/flagged`,  { method: 'POST' }),
    toggleDormant:  (mac) => request(`/network/device/${encodeURIComponent(mac)}/dormant`,  { method: 'POST' }),
    toggleFlag: (mac, flagKey) => request(`/network/device/${encodeURIComponent(mac)}/flag/${encodeURIComponent(flagKey)}`, { method: 'POST' }),
    traceroute: (ip) => request(`/network/traceroute/${encodeURIComponent(ip)}`, { method: 'POST' }),
    flags: {
      getAll: () => request('/network/flags'),
      create: (data) => request('/network/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
      update: (key, data) => request(`/network/flags/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
      remove: (key) => request(`/network/flags/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    },
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
    runSpeedtest:    () => request('/reports/speedtest',     { method: 'POST' }),
    runVpnSpeedtest: () => request('/reports/speedtest/vpn', { method: 'POST' }),
    outages: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from) q.set('from', params.from)
      if (params.to)   q.set('to',   params.to)
      return request(`/reports/outages?${q}`)
    },
    runTraceroute: () => request('/reports/internet/traceroute', { method: 'POST' }),
  },
  auth: {
    status:   ()     => request('/auth/status'),
    register: (data) => request('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    login:    (data) => request('/auth/login',    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    logout:   ()     => request('/auth/logout',   { method: 'POST' }),
  },
  themes: {
    upload: (id, file) => request(`/themes/upload/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    }),
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


/**
 * Data-driven PDF export — professional layout for ISP dispute and service quality documentation.
 * @param {object} reportData
 *   rangeLabel, summary, internetStats, outages, ispConfig, daily, topPorts, speedtests, events
 * @param {string} filename
 */
export async function exportToPdf(reportData, filename = 'report.pdf') {
  const { jsPDF } = await import('jspdf')

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W    = 210, M = 15, COL = W - M * 2
  let   y    = 0

  // ── Design tokens ───────────────────────────────────────────────────────────
  const NAVY       = [30,  45, 120]
  const NAVY_LIGHT = [55,  75, 160]
  const ACCENT     = [59,  79, 212]
  const HDR_BG     = [240, 243, 252]
  const ALT_ROW    = [249, 250, 254]
  const RULE_CLR   = [210, 215, 235]
  const BODY       = [17,  24,  39]
  const MUTED      = [100, 110, 130]
  const LABEL_CLR  = [80,  90, 115]
  const GREEN      = [22,  163, 74]
  const GREEN_BG   = [240, 253, 244]
  const RED        = [200,  35,  35]
  const RED_BG     = [255, 242, 242]
  const AMBER      = [160,  85,   0]
  const AMBER_BG   = [255, 251, 235]
  const ORANGE     = [180,  60,  10]
  const ORANGE_BG  = [255, 247, 237]
  const CARD_BG    = [246, 248, 255]
  const CARD_BD    = [210, 218, 240]
  const WHITE      = [255, 255, 255]
  const FOOTER_CLR = [155, 160, 180]

  // ── Core helpers ────────────────────────────────────────────────────────────
  const sf   = (c)             => doc.setFillColor(...c)
  const sd   = (c)             => doc.setDrawColor(...c)
  const st   = (c)             => doc.setTextColor(...c)
  const box  = (x, yp, w, h, s) => doc.rect(x, yp, w, h, s || 'F')

  function checkPage(need = 8) {
    if (y + need > 280) { doc.addPage(); y = 16 }
  }

  function sectionHead(text) {
    checkPage(20)
    y += 5
    sf(ACCENT); box(M, y - 5, 2.5, 9)
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); st(ACCENT)
    doc.text(text.toUpperCase(), M + 5.5, y)
    y += 1.5
    sd(RULE_CLR); doc.setLineWidth(0.25)
    doc.line(M + 5.5, y, W - M, y)
    y += 4
  }

  function kv(label, value, breach = false, labelW = 55) {
    checkPage(6)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); st(LABEL_CLR)
    doc.text(label, M, y)
    doc.setFont('helvetica', 'bold'); st(breach ? RED : BODY)
    doc.text(String(value ?? '\u2014'), M + labelW, y)
    y += 5.5
  }

  function metricCard(x, yy, w, h, label, value, sub, valueClr) {
    sf(CARD_BG); sd(CARD_BD); doc.setLineWidth(0.25)
    box(x, yy, w, h, 'FD')
    sf(valueClr || ACCENT); box(x, yy, w, 1.5)
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); st(MUTED)
    doc.text(label.toUpperCase(), x + 3, yy + 8)
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); st(valueClr || NAVY)
    doc.text(String(value ?? '\u2014'), x + 3, yy + 17)
    if (sub) {
      doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); st(MUTED)
      doc.text(sub, x + 3, yy + 22.5)
    }
  }

  // Table: columns=[{header,key,w,bold?}], rows=[], opts={colorCell:(key,row)=>null|{bg,text}}
  function table(columns, rows, opts = {}) {
    if (!rows?.length) return
    const rowH  = 5.5
    const rectY = () => y - rowH + 1.5

    function drawHeader() {
      checkPage(rowH * 2.5)
      sf(HDR_BG); box(M, rectY(), COL, rowH)
      sd(ACCENT); doc.setLineWidth(0.4)
      doc.line(M, y + 1.8, W - M, y + 1.8)
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); st(ACCENT)
      let x = M + 2
      for (const col of columns) { doc.text(col.header, x, y); x += col.w }
      y += rowH
    }

    drawHeader()
    doc.setFontSize(8)
    for (let i = 0; i < rows.length; i++) {
      if (y + rowH > 280) { doc.addPage(); y = 16; drawHeader() }
      if (i % 2 === 1) { sf(ALT_ROW); box(M, rectY(), COL, rowH) }
      let x = M + 2
      for (const col of columns) {
        const v  = String(rows[i][col.key] ?? '')
        const cc = opts.colorCell?.(col.key, rows[i])
        if (cc) {
          if (cc.bg) { sf(cc.bg); box(x - 1, y - 3.5, col.w - 0.5, 4.6) }
          st(cc.text); doc.setFont('helvetica', 'bold')
        } else {
          st(col.key === 'num' ? MUTED : BODY)
          doc.setFont('helvetica', col.bold ? 'bold' : 'normal')
        }
        const maxC = Math.floor(col.w / 1.63)
        doc.text(v.length > maxC ? v.slice(0, maxC - 1) + '...' : v, x, y)
        x += col.w
      }
      y += rowH
    }
    sd(RULE_CLR); doc.setLineWidth(0.2)
    doc.line(M, y - 2, W - M, y - 2)
    y += 4
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

  function parseMtrForPdf(text) {
    if (!text) return null
    const hops = []
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(\d+)\.\|--\s+(\S+)\s+([\d.]+)%\s+(\d+)\s+([\d.]+)\s+([\d.]+)/)
      if (m) hops.push({ hop: +m[1], host: m[2], loss: +m[3], avg: +m[6] })
    }
    return hops.length ? hops : null
  }

  // ── Header band ─────────────────────────────────────────────────────────────
  const isp = reportData.ispConfig ?? {}
  sf(NAVY);       box(0, 0, W, 20)
  sf(NAVY_LIGHT); box(0, 18.5, W, 1.5)
  doc.setFontSize(15); doc.setFont('helvetica', 'bold'); st(WHITE)
  doc.text('INTERNET OUTAGE REPORT', M, 11)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); st([200, 210, 240])
  const ispSubtitle = isp.name
    ? `${isp.name}${isp.connection_type ? '  \u2014  ' + isp.connection_type : ''}`
    : 'Network Connectivity Report'
  doc.text(ispSubtitle, M, 17)
  doc.setFontSize(7.5); st([185, 198, 238])
  const periodLine = `Period: ${reportData.rangeLabel ?? 'Custom'}`
  const genLine    = `Generated: ${new Date().toLocaleString('en-GB')}`
  doc.text(periodLine, W - M - doc.getTextWidth(periodLine), 10.5)
  doc.text(genLine,    W - M - doc.getTextWidth(genLine),    17)
  y = 26

  // ── Account details bar ─────────────────────────────────────────────────────
  if (isp.name || isp.account_number) {
    sf([235, 240, 255]); box(M, y - 2.5, COL, 10)
    const details = [
      isp.name            ? `ISP: ${isp.name}`             : null,
      isp.account_number  ? `Account: ${isp.account_number}` : null,
      isp.support_email   ? `Support: ${isp.support_email}` : null,
      isp.expected_uptime != null ? `Contracted uptime: ${isp.expected_uptime}%` : null,
    ].filter(Boolean)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); st(LABEL_CLR)
    const spacing = COL / Math.max(details.length, 1)
    details.forEach((d, i) => doc.text(d, M + i * spacing, y + 3))
    y += 14
  }

  // ── Executive summary ────────────────────────────────────────────────────────
  const is       = reportData.internetStats ?? null
  const slaPct   = isp.expected_uptime ?? 100
  const uptimePct = is ? parseFloat(is.uptime ?? 100) : null
  const uptimeOk  = uptimePct === null || uptimePct >= slaPct

  if (is) {
    sectionHead('Executive Summary')
    checkPage(30)
    const cw = (COL - 9) / 4, ch = 25, cy = y
    metricCard(M,              cy, cw, ch, 'Uptime',        `${is.uptime}%`,
      uptimeOk ? 'Within SLA' : `Target: ${slaPct}%`, uptimeOk ? GREEN : RED)
    metricCard(M + (cw + 3),   cy, cw, ch, 'Total downtime',
      fmtMsPdf(reportData.outages?.totalDowntimeMs ?? 0),
      `${reportData.outages?.totalOutages ?? 0} incident${(reportData.outages?.totalOutages ?? 0) !== 1 ? 's' : ''}`,
      (reportData.outages?.totalDowntimeMs ?? 0) > 0 ? RED : GREEN)
    metricCard(M + (cw + 3)*2, cy, cw, ch, 'Longest outage',
      fmtMsPdf(reportData.outages?.longestMs ?? 0),
      (reportData.outages?.longestMs ?? 0) > 0 ? 'single incident' : 'no outages',
      (reportData.outages?.longestMs ?? 0) > 0 ? AMBER : GREEN)
    metricCard(M + (cw + 3)*3, cy, cw, ch, 'Avg latency',
      `${is.avgLatency} ms`,
      `${Number(is.totalChecks ?? 0).toLocaleString('en-GB')} checks`, NAVY)
    y = cy + ch + 6

    // SLA breach callout
    if (!uptimeOk) {
      checkPage(12)
      sf(RED_BG); sd(RED); doc.setLineWidth(0.4); box(M, y - 2, COL, 10, 'FD')
      sf(RED); box(M, y - 2, 3.5, 10)
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); st(RED)
      doc.text('SLA BREACH', M + 6, y + 3)
      doc.setFont('helvetica', 'normal'); st(BODY)
      doc.text(
        `Recorded uptime of ${is.uptime}% is below the contracted ${slaPct}% target.${isp.name ? `  Escalate to: ${isp.name}.` : ''}`,
        M + 38, y + 3)
      y += 14
    }

    // Connectivity detail strip
    sectionHead('Connectivity Details')
    checkPage(14)
    const statCols = [
      ['Average latency',  `${is.avgLatency} ms`],
      ['Status changes',   String(is.changes ?? 0)],
      ['Checks performed', Number(is.totalChecks ?? 0).toLocaleString('en-GB')],
    ]
    const colW3 = COL / 3
    statCols.forEach(([lbl, val], i) => {
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); st(MUTED)
      doc.text(lbl, M + i * colW3, y)
      doc.setFont('helvetica', 'bold'); st(BODY)
      doc.text(val, M + i * colW3, y + 6)
    })
    y += 14
  }

  // ── Outage incidents ─────────────────────────────────────────────────────────
  if ((reportData.outages?.totalOutages ?? 0) > 0) {
    sectionHead('Outage Incidents')
    kv('Total incidents',  reportData.outages.totalOutages)
    kv('Total downtime',   fmtMsPdf(reportData.outages.totalDowntimeMs))
    kv('Longest incident', fmtMsPdf(reportData.outages.longestMs))
    y += 2
    table(
      [
        { header: '#',                key: 'num',    w: 7  },
        { header: 'Started',          key: 'start',  w: 43 },
        { header: 'Restored',         key: 'end',    w: 43 },
        { header: 'Type',             key: 'type',   w: 16 },
        { header: 'Duration',         key: 'dur',    w: 24, bold: true },
        { header: 'Was up for',       key: 'before', w: 24 },
        { header: 'Last hop reached', key: 'last',   w: 23 },
      ],
      reportData.outages.outages.map((o, i) => {
        const hops    = parseMtrForPdf(o.diagnostics?.traceroute)
        const lastHop = hops ? [...hops].reverse().find(h => h.loss < 100 && h.host !== '???') : null
        return {
          num:    String(i + 1),
          start:  new Date(o.start).toLocaleString('en-GB'),
          end:    o.ongoing ? 'STILL OFFLINE' : new Date(o.end).toLocaleString('en-GB'),
          type:   o.outage_type === 'isp' ? 'ISP' : o.outage_type === 'infra' ? 'Infra' : 'Unknown',
          dur:    fmtMsPdf(o.durationMs) + (o.ongoing ? '+' : ''),
          before: o.uptimeBeforeMs != null ? fmtMsPdf(o.uptimeBeforeMs) : '\u2014',
          last:   lastHop ? `h${lastHop.hop}: ${lastHop.host}` : (hops ? 'none' : '\u2014'),
        }
      }),
      {
        colorCell(key, row) {
          if (key === 'type') {
            if (row.type === 'ISP')     return { bg: ORANGE_BG, text: ORANGE }
            if (row.type === 'Infra')   return { bg: AMBER_BG,  text: AMBER  }
            if (row.type === 'Unknown') return { bg: null,      text: MUTED  }
          }
          if (key === 'end' && row.end === 'STILL OFFLINE') return { bg: RED_BG, text: RED }
          if (key === 'dur') return { bg: null, text: RED }
          return null
        },
      }
    )

    // Packet-path diagnostics (one line per outage that has trace data)
    const withDiag = reportData.outages.outages.filter(o => o.diagnostics?.traceroute)
    if (withDiag.length) {
      checkPage(14)
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); st(LABEL_CLR)
      doc.text('Packet-path diagnostics at time of failure:', M, y)
      y += 6
      for (const o of withDiag) {
        checkPage(8)
        const idx     = reportData.outages.outages.indexOf(o) + 1
        const hops    = parseMtrForPdf(o.diagnostics.traceroute)
        const reached = hops ? hops.filter(h => h.loss < 100 && h.host !== '???') : []
        const last    = reached[reached.length - 1]
        const total   = hops?.length ?? 0
        const pathText = last
          ? `Reached hop ${last.hop}/${total}: ${last.host} (avg ${last.avg.toFixed(1)} ms)${reached.length < total ? ' \u2014 no response beyond this hop' : ' \u2014 destination reached'}`
          : hops
            ? `No hops responded (${o.outage_type === 'infra' ? 'local network issue' : 'complete connectivity loss'})`
            : 'No diagnostic data captured for this outage'
        doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); st(MUTED)
        doc.text(`Outage #${idx}  ${new Date(o.start).toLocaleString('en-GB')}:`, M + 2, y)
        doc.setFont('helvetica', last ? 'normal' : 'bold'); st(last ? BODY : RED)
        doc.text(pathText, M + 54, y)
        y += 5.5
      }
      y += 3
    }
  }

  // ── Speed test performance ───────────────────────────────────────────────────
  if (reportData.speedtests?.length) {
    const planDown = isp.plan_download_mbps ?? 0
    const planUp   = isp.plan_upload_mbps   ?? 0
    const hasPlan  = planDown > 0 || planUp > 0

    if (hasPlan) {
      sectionHead('Speed Test Performance vs SLA')
      const sRows = reportData.speedtests
      const aDown = sRows.reduce((t, r) => t + (r.download_mbps ?? 0), 0) / sRows.length
      const aUp   = sRows.reduce((t, r) => t + (r.upload_mbps   ?? 0), 0) / sRows.length
      const bDown = planDown > 0 ? sRows.filter(r => (r.download_mbps ?? 0) < planDown * 0.8).length : 0
      const bUp   = planUp   > 0 ? sRows.filter(r => (r.upload_mbps   ?? 0) < planUp   * 0.8).length : 0
      const wDown = sRows.reduce((mn, r) => Math.min(mn, r.download_mbps ?? Infinity), Infinity)
      const wUp   = sRows.reduce((mn, r) => Math.min(mn, r.upload_mbps   ?? Infinity), Infinity)
      const slRows = [
        planDown > 0 && ['Avg download',  `${aDown.toFixed(1)} Mbps`, `${Math.round(aDown / planDown * 100)}% of ${planDown} Mbps plan`, aDown < planDown * 0.8],
        planUp   > 0 && ['Avg upload',    `${aUp.toFixed(1)} Mbps`,   `${Math.round(aUp   / planUp   * 100)}% of ${planUp} Mbps plan`,   aUp   < planUp   * 0.8],
        planDown > 0 && wDown !== Infinity && ['Worst download', `${wDown} Mbps`, `${Math.round(wDown / planDown * 100)}% of plan`, wDown < planDown * 0.8],
        planUp   > 0 && wUp   !== Infinity && ['Worst upload',   `${wUp} Mbps`,   `${Math.round(wUp   / planUp   * 100)}% of plan`, wUp   < planUp   * 0.8],
        planDown > 0 && [`Below 80% DL SLA (${planDown} Mbps)`, `${bDown} / ${sRows.length}`, '', bDown > 0],
        planUp   > 0 && [`Below 80% UL SLA (${planUp} Mbps)`,   `${bUp} / ${sRows.length}`,   '', bUp   > 0],
      ].filter(Boolean)
      for (const [lbl, val, note, breach] of slRows) {
        checkPage(6)
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); st(LABEL_CLR)
        doc.text(lbl, M, y)
        doc.setFont('helvetica', 'bold'); st(breach ? RED : GREEN)
        doc.text(val, M + 68, y)
        if (note) { doc.setFont('helvetica', 'normal'); st(MUTED); doc.text(note, M + 94, y) }
        if (breach) { doc.setFont('helvetica', 'bold'); st(RED); doc.text('[BREACH]', M + 150, y) }
        y += 5.5
      }
      y += 2
    } else {
      sectionHead('Speed Test History')
    }

    // Speed test detail table (always shown)
    checkPage(14)
    table(
      [
        { header: 'Date',      key: 'ts',      w: 34 },
        { header: 'Via',       key: 'via',     w: 14 },
        { header: 'Download',  key: 'download',w: 28 },
        { header: 'Upload',    key: 'upload',  w: 24 },
        ...(hasPlan ? [{ header: '% of plan', key: 'plan', w: 22 }] : []),
        { header: 'Latency',   key: 'latency', w: 20 },
        { header: 'Server',    key: 'server',  w: hasPlan ? 38 : 60 },
      ],
      reportData.speedtests.slice(0, 50).map(r => {
        const dlPct = planDown > 0 && r.download_mbps != null ? Math.round(r.download_mbps / planDown * 100) : null
        const ulPct = planUp   > 0 && r.upload_mbps   != null ? Math.round(r.upload_mbps   / planUp   * 100) : null
        return {
          ts:       new Date(r.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
          via:      r.via === 'vpn' ? 'VPN' : 'Direct',
          download: r.download_mbps != null ? `${r.download_mbps} Mbps` : '\u2014',
          upload:   r.upload_mbps   != null ? `${r.upload_mbps} Mbps`   : '\u2014',
          plan:     [dlPct != null ? `DL ${dlPct}%` : '', ulPct != null ? `UL ${ulPct}%` : ''].filter(Boolean).join(' ') || '\u2014',
          latency:  r.ping_ms != null ? `${r.ping_ms} ms` : '\u2014',
          server:   r.server_name ?? r.server_host ?? '\u2014',
        }
      }),
      {
        colorCell(key, row) {
          if (key === 'plan' && row.plan !== '\u2014') {
            const nums = row.plan.match(/\d+/g)?.map(Number) ?? []
            if (nums.some(n => n < 80))    return { bg: RED_BG,   text: RED   }
            if (nums.every(n => n >= 100)) return { bg: GREEN_BG, text: GREEN }
          }
          return null
        },
      }
    )
  }

  // ── Daily activity ────────────────────────────────────────────────────────────
  if (reportData.daily?.length) {
    sectionHead('Daily Activity')
    table(
      [
        { header: 'Date',    key: 'date',    w: 40 },
        { header: 'New',     key: 'new',     w: 28 },
        { header: 'Online',  key: 'online',  w: 32 },
        { header: 'Offline', key: 'offline', w: 32 },
        { header: 'Ports',   key: 'ports',   w: 28 },
      ],
      reportData.daily
    )
  }

  // ── Top ports ─────────────────────────────────────────────────────────────────
  if (reportData.topPorts?.length) {
    sectionHead('Top Ports Discovered')
    table(
      [
        { header: 'Port / Service', key: 'port',  w: 100 },
        { header: 'Occurrences',    key: 'count', w: 80  },
      ],
      reportData.topPorts
    )
  }

  // ── Recent events ─────────────────────────────────────────────────────────────
  if (reportData.events?.length) {
    sectionHead('Recent Events')
    table(
      [
        { header: 'Time',   key: 'ts',     w: 38 },
        { header: 'Event',  key: 'event',  w: 55 },
        { header: 'Device', key: 'device', w: 55 },
        { header: 'Source', key: 'source', w: 22 },
      ],
      reportData.events.slice(0, 60).map(e => ({
        ts:     new Date(e.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        event:  e.event,
        device: e.hostname || e.ip || '',
        source: e.source,
      }))
    )
  }

  // ── SLA reference ─────────────────────────────────────────────────────────────
  if (isp.sla_url || isp.sla_notes) {
    sectionHead('SLA Reference')
    if (isp.sla_url)   kv('SLA document', isp.sla_url)
    if (isp.sla_notes) kv('Notes',        isp.sla_notes)
    y += 2
  }

  // ── Footer on every page ──────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    sd(RULE_CLR); doc.setLineWidth(0.3)
    doc.line(M, 285, W - M, 285)
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); st(FOOTER_CLR)
    doc.text('Generated by Claudette Network Monitor  \u00b7  For ISP dispute and service quality documentation purposes', M, 290)
    const pgTxt = `Page ${i} of ${pageCount}`
    doc.text(pgTxt, W - M - doc.getTextWidth(pgTxt), 290)
  }

  doc.save(filename)
}
