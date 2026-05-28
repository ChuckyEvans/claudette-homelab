import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { BarChart2, RefreshCw, X, ChevronLeft, ChevronRight, Monitor, Activity, Server, Wifi, Download, Clock, Zap, Search, AlertTriangle, Copy, Check, TrendingDown, ClipboardCheck } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
} from 'recharts'
import { api, exportToCsv, exportToPng, exportToPdf } from '../lib/api.js'
import Pagination from './Pagination.jsx'

const PAGE_SIZE = 50

// ── Lightweight toast ─────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([])
  const add = useCallback((message) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])
  return { toasts, add }
}

function ToastStack({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className="flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium
            bg-emerald-950/95 border-emerald-500/30 text-emerald-300 backdrop-blur-sm
            animate-[fadeSlideUp_0.2s_ease-out]">
          <ClipboardCheck className="w-4 h-4 flex-shrink-0" />
          {t.message}
        </div>
      ))}
    </div>
  )
}

const CHART_PALETTE = { new: '#10b981', online: '#38bdf8', offline: '#64748b', ports: '#818cf8' }

function rangeMs(key) {
  if (key === 'today') { const s = new Date(); s.setHours(0, 0, 0, 0); return Date.now() - s.getTime() }
  return { '7d': 7, '30d': 30, '90d': 90 }[key] * 86_400_000
}

const RANGE_OPTS   = ['today', '7d', '30d', '90d']
const RANGE_LABELS = { today: 'Today', '7d': '7d', '30d': '30d', '90d': '90d' }

const EV_FILTERS = [
  { label: 'All',      value: '' },
  { label: 'Devices',  value: 'device' },
  { label: 'Services', value: 'service' },
  { label: 'Scans',    value: 'scan' },
  { label: 'Threats',  value: 'threat' },
  { label: 'Internet', value: 'internet' },
]

const EV_COLORS = {
  'device.new':        'text-emerald-400 bg-emerald-500/10',
  'device.online':     'text-sky-400     bg-sky-500/10',
  'device.offline':    'text-slate-400   bg-white/5',
  'device.port.open':  'text-indigo-400  bg-indigo-500/10',
  'service.down':      'text-red-400     bg-red-500/10',
  'service.up':        'text-emerald-400 bg-emerald-500/10',
  'internet.down':     'text-red-400     bg-red-500/10',
  'internet.up':       'text-emerald-400 bg-emerald-500/10',
  'internet.check':    'text-sky-300     bg-sky-500/5',
  'scan.complete':     'text-indigo-400  bg-indigo-500/10',
  'scan.started':      'text-indigo-300  bg-indigo-500/8',
  'threat.found':      'text-amber-400   bg-amber-500/10',
}
function evColor(ev) { return EV_COLORS[ev] ?? 'text-slate-400 bg-white/5' }

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(payload) {
  const p = !payload ? null
    : typeof payload === 'string' ? (() => { try { return JSON.parse(payload) } catch { return null } })()
    : payload
  if (!p?.durationMs) return null
  const s = p.durationMs / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`
}

function fmtPayload(evName, payload) {
  if (!payload) return null
  const p = typeof payload === 'string' ? (() => { try { return JSON.parse(payload) } catch { return {} } })() : payload
  const parts = []
  if (p.hostname)              parts.push(p.hostname)
  if (p.ip)                    parts.push(p.ip)
  if (p.port)                  parts.push(`port ${p.port}`)
  if (p.name)                  parts.push(p.name)
  if (p.devices_found != null) parts.push(`${p.devices_found} devices`)
  if (p.up != null)            parts.push(`${p.up} up / ${p.down ?? 0} down`)
  if (p.ok != null && evName?.startsWith('internet')) parts.push(p.ok ? 'online' : 'offline')
  if (parts.length === 0)      return JSON.stringify(p).slice(0, 80)
  return parts.join(' · ')
}

function fmtMs(ms) {
  if (!ms || ms <= 0) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), rs = s % 60
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`
  const h = Math.floor(m / 60), rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

function ChartTip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0d0d1a] border border-[#1a1a35] rounded-lg px-3 py-2 text-xs shadow-xl">
      {(labelFormatter ? labelFormatter(label) : label) && (
        <p className="text-slate-300 font-medium mb-1">{labelFormatter ? labelFormatter(label) : label}</p>
      )}
      {payload.map(p => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2 text-slate-400">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.fill || p.stroke }} />
          <span className="capitalize">{p.name}:</span>
          <span className="text-white font-medium ml-1">{p.value}{p.unit ?? ''}</span>
        </div>
      ))}
    </div>
  )
}

const TABS = [
  { id: 'overview',  label: 'Overview',   Icon: BarChart2 },
  { id: 'internet',  label: 'Internet',   Icon: Wifi      },
  { id: 'speedtest', label: 'Speed Test', Icon: Zap       },
  { id: 'activity',  label: 'Activity',   Icon: Activity  },
]

export default function Reports() {
  const [tab,          setTab]          = useState('overview')
  const [range,        setRange]        = useState('7d')
  const [eventFilter,  setEventFilter]  = useState('')
  const [macFilter,    setMacFilter]    = useState('')
  const [subnetFilter, setSubnetFilter] = useState('')
  const [page,         setPage]         = useState(0)
  const [activitySearch, setActivitySearch] = useState('')
  const [data,         setData]         = useState(null)
  const [chartData,    setChartData]    = useState(null)
  const [devices,      setDevices]      = useState([])
  const [subnets,      setSubnets]      = useState([])
  const [ispConfig,    setIspConfig]    = useState({})
  const [loading,      setLoading]      = useState(false)
  const [drillDay,     setDrillDay]     = useState(null) // { from, to, label }
  const [internetData,  setInternetData]  = useState(null)
  const [speedtestData, setSpeedtestData] = useState(null)
  const [exporting,     setExporting]     = useState(null)
  const [running,       setRunning]       = useState(false)
  const [outageData,    setOutageData]    = useState(null)
  const [copiedIsp,     setCopiedIsp]     = useState(false)
  const [internetStatusFilter, setInternetStatusFilter] = useState('') // '' | 'online' | 'offline'
  const [internetSearch,       setInternetSearch]       = useState('')
  const [speedtestSearch,      setSpeedtestSearch]      = useState('')
  const [speedtestBelowSla,    setSpeedtestBelowSla]    = useState(false)
  const { toasts, add: addToast } = useToast()
  const tableRef = useRef(null)

  const loadData = useCallback(async () => {
    const to   = drillDay?.to   ?? Date.now()
    const from = drillDay?.from ?? (to - rangeMs(range))
    setLoading(true)
    try {
      const res = await api.reports.get({
        from, to,
        ...(eventFilter  && { event:  eventFilter }),
        ...(macFilter    && { mac:    macFilter }),
        ...(subnetFilter && { subnet: subnetFilter }),
        limit:  PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setData(res)
    } catch (e) {
      console.error('[Reports]', e)
    } finally {
      setLoading(false)
    }
  }, [range, drillDay, eventFilter, macFilter, subnetFilter, page])

  const loadCharts = useCallback(async () => {
    const to   = Date.now()
    const from = to - rangeMs(range)
    try {
      setChartData(await api.reports.chart({ from, to }))
    } catch (e) {
      console.error('[Reports/chart]', e)
    }
  }, [range])

  const loadInternet = useCallback(async () => {
    const to   = Date.now()
    const from = to - rangeMs(range)
    try {
      setInternetData(await api.reports.internet({ from, to, limit: 100 }))
    } catch (e) {
      console.error('[Reports/internet]', e)
    }
  }, [range])

  const loadSpeedtest = useCallback(async () => {
    const to   = Date.now()
    const from = to - rangeMs(range)
    try {
      setSpeedtestData(await api.reports.speedtest({ from, to, limit: 200 }))
    } catch (e) {
      console.error('[Reports/speedtest]', e)
    }
  }, [range])

  const loadOutages = useCallback(async () => {
    const to   = Date.now()
    const from = to - rangeMs(range)
    try {
      setOutageData(await api.reports.outages({ from, to }))
    } catch (e) {
      console.error('[Reports/outages]', e)
    }
  }, [range])

  useEffect(() => { loadData()    }, [loadData])
  useEffect(() => { loadCharts()  }, [loadCharts])
  useEffect(() => { loadInternet() }, [loadInternet])
  useEffect(() => { loadSpeedtest() }, [loadSpeedtest])
  useEffect(() => { loadOutages()  }, [loadOutages])

  useEffect(() => {
    api.reports.devices().then(r => setDevices(r.devices ?? [])).catch(() => {})
    api.config.get().then(cfg => {
      const raw = cfg?.network?.subnets ?? (cfg?.network?.subnet ? [cfg.network.subnet] : [])
      setSubnets(raw)
      setIspConfig(cfg?.isp ?? {})
    }).catch(() => {})
  }, [])

  function changeRange(r) { setRange(r); setDrillDay(null); setPage(0) }
  function changeEvFilter(v) { setEventFilter(v); setPage(0) }

  function handleBarClick(barData, seriesKey) {
    if (!barData?.date) return
    const d    = new Date(barData.date + 'T00:00:00')
    const from = d.getTime()
    const to   = from + 86_400_000 - 1
    setDrillDay({ from, to, label: barData.date })
    const evMap = { new: 'device.new', online: 'device.online', offline: 'device.offline', ports: 'device.port.open' }
    setEventFilter(evMap[seriesKey] ?? '')
    setPage(0)
    setTab('activity')
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  function clearDrilldown() { setDrillDay(null); setEventFilter(''); setPage(0) }

  const summary    = data?.summary ?? {}
  const events     = data?.events  ?? []
  const total      = data?.total   ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const dateStamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const fmtLocalTs = ts => { const d = new Date(ts); const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
  const rangeLabel = drillDay ? drillDay.label : RANGE_LABELS[range]

  async function handleExportCsv() {
    try {
      setExporting('csv')
      const to   = drillDay?.to   ?? Date.now()
      const from = drillDay?.from ?? (to - rangeMs(range))
      // Fetch all data types concurrently
      const [inetData, speedData, evData, outData] = await Promise.all([
        api.reports.internet({ from, to, limit: 5000 }),
        api.reports.speedtest({ from, to, limit: 5000 }),
        api.reports.get({ from, to, ...(eventFilter && { event: eventFilter }), ...(macFilter && { mac: macFilter }), limit: 5000, offset: 0 }),
        api.reports.outages({ from, to }),
      ])
      const rows = [
        // Internet outage incidents (most important for ISP accountability)
        ...(outData.outages ?? []).map((o, i) => ({
          section: 'internet_outage',
          timestamp: fmtLocalTs(o.start),
          event: o.ongoing ? 'internet.outage.ongoing' : 'internet.outage',
          detail: `duration:${fmtMs(o.durationMs)}${o.ongoing ? '+' : ''} end:${o.end ? fmtLocalTs(o.end) : 'ongoing'}`,
          device: '',
        })),
        // Internet connectivity checks
        ...(inetData.checks ?? []).map(c => ({
          section: 'internet',
          timestamp: fmtLocalTs(c.ts),
          event: c.ok ? 'online' : 'offline',
          detail: c.avgMs != null ? `${c.avgMs}ms` : '',
          device: '',
        })),
        // Speed tests
        ...(speedData.results ?? []).map(r => {
          const pDown = ispConfig?.plan_download_mbps ?? 0
          const pUp   = ispConfig?.plan_upload_mbps   ?? 0
          const dPct  = pDown > 0 && r.download_mbps != null ? ` (${Math.round(r.download_mbps / pDown * 100)}%)` : ''
          const uPct  = pUp   > 0 && r.upload_mbps   != null ? ` (${Math.round(r.upload_mbps   / pUp   * 100)}%)` : ''
          return {
            section: 'speedtest',
            timestamp: fmtLocalTs(r.ts),
            event: 'speedtest',
            detail: [
              r.download_mbps != null ? `down:${r.download_mbps}Mbps${dPct}` : '',
              r.upload_mbps   != null ? `up:${r.upload_mbps}Mbps${uPct}` : '',
              r.ping_ms       != null ? `ping:${r.ping_ms}ms` : '',
              r.server_name ?? r.server_host ? `srv:${r.server_name ?? r.server_host}` : '',
            ].filter(Boolean).join(' '),
            device: r.client_ip ?? '',
          }
        }),
        // All events
        ...(evData.events ?? []).map(e => ({
          section: e.source ?? 'event',
          timestamp: fmtLocalTs(e.ts),
          event: e.event,
          detail: e.payload ? JSON.stringify(e.payload) : '',
          device: e.hostname || e.ip || e.mac || '',
        })),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      exportToCsv(rows, `claudette-report-${dateStamp()}.csv`)
    } catch (e) {
      console.error('CSV export failed:', e)
    } finally {
      setExporting(null)
    }
  }

  async function handleExportPng() {
    try {
      setExporting('png')
      await exportToPng('reports-root', `claudette-report-${dateStamp()}.png`)
    } catch (e) {
      console.error('PNG export failed:', e)
    } finally {
      setExporting(null)
    }
  }

  async function handleExportPdf() {
    try {
      setExporting('pdf')
      const to   = drillDay?.to   ?? Date.now()
      const from = drillDay?.from ?? (to - rangeMs(range))
      // Fetch full dataset for PDF
      const [speedData, evData] = await Promise.all([
        api.reports.speedtest({ from, to, limit: 200 }),
        api.reports.get({ from, to, limit: 200, offset: 0 }),
      ])
      await exportToPdf({
        rangeLabel,
        summary:       data?.summary,
        internetStats: chartData?.internetStats,
        outages:       outageData,
        ispConfig,
        daily:         chartData?.daily,
        topPorts:      chartData?.topPorts,
        speedtests:    speedData?.results,
        events:        evData?.events,
      }, `claudette-report-${dateStamp()}.pdf`)
    } catch (e) {
      console.error('PDF export failed:', e)
    } finally {
      setExporting(null)
    }
  }

  async function handleRunSpeedtest() {
    try {
      setRunning(true)
      await api.reports.runSpeedtest()
      // Poll for result after ~35s (download + upload takes ~30s)
      setTimeout(() => { loadSpeedtest(); setRunning(false) }, 35000)
    } catch (e) {
      console.error('Speed test failed:', e)
      setRunning(false)
    }
  }

  function handleCopyIspReport() {
    const isp  = ispConfig?.name            || 'Unknown ISP'
    const conn = ispConfig?.connection_type || 'broadband'
    const upSla = ispConfig?.expected_uptime ?? 100
    const acct  = ispConfig?.account_number  || ''
    const email = ispConfig?.support_email   || ''
    const lines = []
    lines.push('INTERNET OUTAGE REPORT')
    lines.push('======================')
    lines.push(`Generated:       ${new Date().toLocaleString('en-GB')}`)
    lines.push(`Period:          ${rangeLabel}`)
    lines.push(`ISP:             ${isp}${conn ? ` (${conn})` : ''}`)
    if (acct)  lines.push(`Account No:      ${acct}`)
    if (email) lines.push(`Support Email:   ${email}`)
    lines.push(`Expected uptime: ${upSla}% — no planned maintenance windows`)
    lines.push('')
    const stats = chartData?.internetStats
    if (stats) {
      lines.push('CONNECTIVITY SUMMARY')
      lines.push('--------------------')
      lines.push(`Uptime:             ${stats.uptime}%`)
      lines.push(`Total downtime:     ${fmtMs(outageData?.totalDowntimeMs ?? 0)}`)
      lines.push(`Total incidents:    ${outageData?.totalOutages ?? 0}`)
      lines.push(`Longest incident:   ${fmtMs(outageData?.longestMs ?? 0)}`)
      lines.push(`Average latency:    ${stats.avgLatency} ms`)
      lines.push(`Checks performed:   ${stats.totalChecks}`)
      lines.push('')
    }
    if (outageData?.outages?.length) {
      lines.push('OUTAGE INCIDENTS')
      lines.push('----------------')
      outageData.outages.forEach((o, i) => {
        lines.push(`${i + 1}. Start:         ${new Date(o.start).toLocaleString('en-GB')}`)
        lines.push(`   End:           ${o.ongoing ? '(ONGOING — still offline at time of report)' : new Date(o.end).toLocaleString('en-GB')}`)
        lines.push(`   Down for:      ${fmtMs(o.durationMs)}${o.ongoing ? '+' : ''}`)
        lines.push(`   Was up for:    ${o.uptimeBeforeMs != null ? fmtMs(o.uptimeBeforeMs) : 'unknown (first recorded event)'}`)
        lines.push('')
      })
    } else {
      lines.push('No outages recorded in this period.')
      lines.push('')
    }
    // Speed SLA section
    if (speedtestData?.results?.length && (ispConfig?.plan_download_mbps > 0 || ispConfig?.plan_upload_mbps > 0)) {
      const sRows    = speedtestData.results
      const planDown = ispConfig.plan_download_mbps ?? 0
      const planUp   = ispConfig.plan_upload_mbps   ?? 0
      const aDown    = (sRows.reduce((s, r) => s + (r.download_mbps ?? 0), 0) / sRows.length).toFixed(1)
      const aUp      = (sRows.reduce((s, r) => s + (r.upload_mbps   ?? 0), 0) / sRows.length).toFixed(1)
      const bDown    = planDown > 0 ? sRows.filter(r => (r.download_mbps ?? 0) < planDown * 0.8).length : 0
      const bUp      = planUp   > 0 ? sRows.filter(r => (r.upload_mbps   ?? 0) < planUp   * 0.8).length : 0
      const wDown    = sRows.reduce((mn, r) => Math.min(mn, r.download_mbps ?? Infinity), Infinity)
      const wUp      = sRows.reduce((mn, r) => Math.min(mn, r.upload_mbps   ?? Infinity), Infinity)
      lines.push('SPEED TEST RESULTS VS SLA')
      lines.push('-------------------------')
      if (planDown > 0) lines.push(`Plan download:          ${planDown} Mbps`)
      if (planUp   > 0) lines.push(`Plan upload:            ${planUp} Mbps`)
      lines.push(`Tests in period:        ${sRows.length}`)
      if (planDown > 0) lines.push(`Average download:       ${aDown} Mbps  (${Math.round(parseFloat(aDown) / planDown * 100)}% of plan)`)
      if (planUp   > 0) lines.push(`Average upload:         ${aUp} Mbps  (${Math.round(parseFloat(aUp)   / planUp   * 100)}% of plan)`)
      if (planDown > 0) lines.push(`Below 80% download SLA: ${bDown} / ${sRows.length} tests  ${bDown > 0 ? '⚠ SLA BREACH' : '✓ OK'}`)
      if (planUp   > 0) lines.push(`Below 80% upload SLA:   ${bUp} / ${sRows.length} tests  ${bUp   > 0 ? '⚠ SLA BREACH' : '✓ OK'}`)
      if (planDown > 0 && wDown !== Infinity) lines.push(`Worst download:         ${wDown} Mbps  (${Math.round(wDown / planDown * 100)}% of plan)`)
      if (planUp   > 0 && wUp   !== Infinity) lines.push(`Worst upload:           ${wUp} Mbps  (${Math.round(wUp   / planUp   * 100)}% of plan)`)
      lines.push('')
    }
    lines.push('---')
    lines.push('Report generated by Claudette Network Monitor')
    const text = lines.join('\n')
    const write = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(text)
      : new Promise(resolve => {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          resolve()
        })
    write.then(() => { setCopiedIsp(true); setTimeout(() => setCopiedIsp(false), 2000); addToast('ISP report copied to clipboard') }).catch(() => {})
  }

  return (
    <div id="reports-root" className="flex flex-col h-full overflow-hidden">
      <ToastStack toasts={toasts} />
      <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <BarChart2 className="w-5 h-5 text-indigo-400" />
          <h1 className="text-lg font-bold text-white">Reports</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { loadData(); loadCharts(); loadInternet(); loadSpeedtest(); loadOutages() }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[#1a1a35] text-slate-400 hover:text-slate-200 hover:border-[#2a2a4a] rounded-lg transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button onClick={handleExportCsv} disabled={exporting} title="Export to CSV"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#1a1a35] text-slate-400 hover:text-slate-200 hover:border-[#2a2a4a] rounded-lg transition-colors disabled:opacity-40">
            <Download className={`w-3.5 h-3.5 ${exporting === 'csv' ? 'animate-spin' : ''}`} />
            {exporting === 'csv' ? 'CSV...' : 'CSV'}
          </button>
          <button onClick={handleExportPng} disabled={exporting} title="Export to PNG"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#1a1a35] text-slate-400 hover:text-slate-200 hover:border-[#2a2a4a] rounded-lg transition-colors disabled:opacity-40">
            <Download className={`w-3.5 h-3.5 ${exporting === 'png' ? 'animate-spin' : ''}`} />
            {exporting === 'png' ? 'PNG...' : 'PNG'}
          </button>
          <button onClick={handleExportPdf} disabled={exporting} title="Export to PDF"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#1a1a35] text-slate-400 hover:text-slate-200 hover:border-[#2a2a4a] rounded-lg transition-colors disabled:opacity-40">
            <Download className={`w-3.5 h-3.5 ${exporting === 'pdf' ? 'animate-spin' : ''}`} />
            {exporting === 'pdf' ? 'PDF...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Tab bar + range selector */}
      <div className="flex items-center justify-between px-6 pb-2 flex-shrink-0 border-b border-[#1a1a30]">
        <div className="flex gap-0.5">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-t transition-colors ${
                tab === id
                  ? 'text-indigo-300 border-b-2 border-indigo-500 pb-[6px]'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 p-0.5 bg-[#0a0a18] rounded-lg border border-[#1a1a30]">
          {RANGE_OPTS.map(r => (
            <button key={r} onClick={() => changeRange(r)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                range === r && !drillDay ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Persistent filter bar (shown whenever the current tab has filterable data) ── */}
      {(tab === 'activity' || tab === 'internet' || tab === 'speedtest') && (
        <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 flex-shrink-0 border-b border-[#1a1a30] bg-[#08080f]">
          {/* Activity filters */}
          {tab === 'activity' && (
            <>
              {EV_FILTERS.map(f => (
                <button key={f.value} onClick={() => changeEvFilter(f.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    eventFilter === f.value
                      ? 'bg-indigo-600/25 border-indigo-500/50 text-indigo-300'
                      : 'border-[#1a1a30] text-slate-400 hover:text-slate-200'
                  }`}
                >{f.label}</button>
              ))}
              {devices.length > 0 && (
                <select value={macFilter} onChange={e => { setMacFilter(e.target.value); setPage(0) }}
                  className="bg-[#0a0a18] border border-[#1a1a30] rounded-lg px-2.5 py-1 text-xs text-slate-400 focus:outline-none focus:border-indigo-500/60">
                  <option value="">All devices</option>
                  {devices.map(d => (
                    <option key={d.mac} value={d.mac}>{d.hostname || d.ip || d.mac}</option>
                  ))}
                </select>
              )}
              {subnets.length > 1 && (
                <select value={subnetFilter} onChange={e => { setSubnetFilter(e.target.value); setPage(0) }}
                  className="bg-[#0a0a18] border border-[#1a1a30] rounded-lg px-2.5 py-1 text-xs text-slate-400 focus:outline-none focus:border-indigo-500/60">
                  <option value="">All subnets</option>
                  {subnets.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </>
          )}

          {/* Internet filters */}
          {tab === 'internet' && (
            <>
              {[['', 'All'], ['online', 'Online'], ['offline', 'Offline']].map(([v, label]) => (
                <button key={v} onClick={() => setInternetStatusFilter(v)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    internetStatusFilter === v
                      ? v === 'offline' ? 'bg-red-600/25 border-red-500/50 text-red-300'
                      : v === 'online'  ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-300'
                      : 'bg-indigo-600/25 border-indigo-500/50 text-indigo-300'
                      : 'border-[#1a1a30] text-slate-400 hover:text-slate-200'
                  }`}
                >{label}</button>
              ))}
            </>
          )}

          {/* Speed test filters */}
          {tab === 'speedtest' && (ispConfig?.plan_download_mbps > 0 || ispConfig?.plan_upload_mbps > 0) && (
            <button onClick={() => setSpeedtestBelowSla(v => !v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                speedtestBelowSla
                  ? 'bg-red-600/25 border-red-500/50 text-red-300'
                  : 'border-[#1a1a30] text-slate-400 hover:text-slate-200'
              }`}>
              Below SLA only
            </button>
          )}

          {/* Search — rightmost on every filterable tab */}
          <div className="relative ml-auto">
            <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={tab === 'activity' ? activitySearch : tab === 'internet' ? internetSearch : speedtestSearch}
              onChange={e => {
                const v = e.target.value
                if (tab === 'activity') setActivitySearch(v)
                else if (tab === 'internet') setInternetSearch(v)
                else setSpeedtestSearch(v)
              }}
              placeholder={tab === 'activity' ? 'Search events, IP…' : tab === 'internet' ? 'Filter by time, hosts…' : 'Search server, ISP, IP…'}
              className="bg-[#0a0a18] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg pl-7 pr-3 py-1 text-xs text-slate-300 placeholder-slate-600 outline-none w-44"
            />
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <>
            {/* Summary count cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {[
                { label: 'New Devices',    value: summary.newDevices,    color: 'text-emerald-400', Icon: Monitor,   ev: 'device.new'       },
                { label: 'Online Events',  value: summary.onlineEvents,  color: 'text-sky-400',     Icon: Wifi,      ev: 'device.online'    },
                { label: 'Offline Events', value: summary.offlineEvents, color: 'text-slate-300',   Icon: Wifi,      ev: 'device.offline'   },
                { label: 'Ports Found',    value: summary.portFinds,     color: 'text-indigo-400',  Icon: Server,    ev: 'device.port.open' },
                { label: 'Svc Outages',    value: summary.serviceDown,   color: 'text-red-400',     Icon: Activity,  ev: 'service.down'     },
                { label: 'Scans Run',      value: summary.scansRun,      color: 'text-violet-400',  Icon: BarChart2, ev: 'scan'             },
              ].map(({ label, value, color, Icon, ev }) => (
                <button key={label}
                  onClick={() => { setEventFilter(ev); setDrillDay(null); setTab('activity') }}
                  className="rounded-xl px-4 py-3 border border-[#1a1a30] bg-[#0a0a18] hover:border-[#2a2a45] text-left transition-all"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`w-3 h-3 ${color}`} />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
                  </div>
                  <p className={`text-xl font-bold tabular-nums ${color}`}>{value ?? 0}</p>
                </button>
              ))}
            </div>

            {/* Activity timeline */}
            {(chartData?.daily?.length ?? 0) > 0 ? (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                <p className="text-xs font-medium text-slate-400 mb-3">
                  Activity Timeline
                  <span className="text-slate-600 font-normal ml-1.5">— click a bar to drill into that day</span>
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData.daily} margin={{ top: 2, right: 4, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} />
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '6px' }} />
                    <Bar dataKey="new"     name="New"     fill={CHART_PALETTE.new}     radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'new')} />
                    <Bar dataKey="online"  name="Online"  fill={CHART_PALETTE.online}  radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'online')} />
                    <Bar dataKey="offline" name="Offline" fill={CHART_PALETTE.offline} radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'offline')} />
                    <Bar dataKey="ports"   name="Ports"   fill={CHART_PALETTE.ports}   radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'ports')} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-600 text-sm">
                No activity data for this range
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top ports */}
              {(chartData?.topPorts?.length ?? 0) > 0 ? (
                <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                  <p className="text-xs font-medium text-slate-400 mb-3">Top Ports Discovered</p>
                  <ResponsiveContainer width="100%" height={Math.max(120, chartData.topPorts.length * 26)}>
                    <BarChart data={chartData.topPorts} layout="vertical" margin={{ top: 0, right: 16, left: 16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="port" width={44} tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }} />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="count" name="Finds" fill="#818cf8" radius={[0,2,2,0]} maxBarSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-600 text-sm">
                  No port discovery data
                </div>
              )}

              {/* Service outages */}
              {(chartData?.serviceDowns?.length ?? 0) > 0 ? (
                <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                  <p className="text-xs font-medium text-slate-400 mb-3">Service Outages</p>
                  <ResponsiveContainer width="100%" height={Math.max(60, chartData.serviceDowns.length * 32)}>
                    <BarChart data={chartData.serviceDowns} layout="vertical" margin={{ top: 0, right: 16, left: 70, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={70} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="count" name="Outages" fill="#f87171" radius={[0,2,2,0]} maxBarSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-600 text-sm">
                  No service outages recorded
                </div>
              )}
            </div>
          </>
        )}

        {/* ── INTERNET ── */}
        {tab === 'internet' && (
          <>
            {/* Internet stats cards */}
            {chartData?.internetStats ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Internet Uptime',  value: `${Number(chartData.internetStats.uptime).toFixed(chartData.internetStats.uptime === 100 ? 1 : 3)}%`, color: chartData.internetStats.uptime < 99.9 ? 'text-red-400' : chartData.internetStats.uptime < 100 ? 'text-amber-400' : 'text-emerald-400', Icon: Wifi },
                  { label: 'Avg Latency',      value: `${chartData.internetStats.avgLatency}ms`,  color: 'text-sky-400',    Icon: Zap      },
                  { label: 'Checks Total',     value: chartData.internetStats.totalChecks,        color: 'text-indigo-400', Icon: Clock    },
                  { label: 'Status Changes',   value: chartData.internetStats.changes,            color: 'text-violet-400', Icon: Activity },
                ].map(({ label, value, color, Icon }) => (
                  <div key={label} className={`rounded-xl px-4 py-3 border bg-[#0a0a18] ${
                    label === 'Internet Uptime' && chartData.internetStats.uptime < 100 ? 'border-red-500/40' : 'border-[#1a1a30]'
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className={`w-3 h-3 ${color}`} />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
                    </div>
                    <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['Internet Uptime', 'Avg Latency', 'Checks Total', 'Status Changes'].map(l => (
                  <div key={l} className="rounded-xl px-4 py-3 border border-[#1a1a30] bg-[#0a0a18] animate-pulse">
                    <div className="h-3 w-20 bg-[#1a1a30] rounded mb-2" />
                    <div className="h-6 w-12 bg-[#1a1a30] rounded" />
                  </div>
                ))}
              </div>
            )}

            {/* SLA pass/fail panel + percentile pills */}
            {chartData?.internetStats && (() => {
              const uptime  = Number(chartData.internetStats.uptime)
              const target  = ispConfig?.expected_uptime ?? null
              const TIERS   = [100, 99.9, 99.5, 99, 95, 90]
              const pDown   = ispConfig?.plan_download_mbps ?? 0
              const pUp     = ispConfig?.plan_upload_mbps   ?? 0
              const avgDown = chartData?.speedStats?.avgDown ?? null
              const avgUp   = chartData?.speedStats?.avgUp   ?? null
              const slaDown = pDown > 0 ? pDown * 0.8 : null
              const slaUp   = pUp   > 0 ? pUp   * 0.8 : null
              const uptimePass = target !== null ? uptime >= target : null
              return (
                <div className="space-y-2">
                  {/* Percentile tier pills */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide mr-1">Uptime tiers</span>
                    {TIERS.map(tier => {
                      const pass = uptime >= tier
                      return (
                        <span key={tier} title={pass ? `✓ Meets ${tier}% SLA` : `✗ Below ${tier}% SLA`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border cursor-default ${
                            pass
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-red-500/10 border-red-500/30 text-red-400'
                          }`}>
                          {pass ? '✓' : '✗'} {tier}%
                        </span>
                      )
                    })}
                    {target !== null && (
                      <span className="text-[10px] text-slate-600 ml-1">· SLA target: {target}%</span>
                    )}
                  </div>
                  {/* SLA summary row (only if ISP config is set) */}
                  {(target !== null || slaDown !== null || slaUp !== null) && (
                    <div className="flex flex-wrap gap-2">
                      {target !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          uptimePass
                            ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300'
                            : 'bg-red-500/8 border-red-500/25 text-red-300'
                        }`}>
                          <span>{uptimePass ? '✓' : '✗'}</span>
                          <span className="font-medium">Uptime SLA</span>
                          <span className="opacity-70">{uptime.toFixed(uptime === 100 ? 1 : 3)}% / {target}% target</span>
                        </div>
                      )}
                      {slaDown !== null && avgDown !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          avgDown >= slaDown
                            ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300'
                            : 'bg-red-500/8 border-red-500/25 text-red-300'
                        }`}>
                          <span>{avgDown >= slaDown ? '✓' : '✗'}</span>
                          <span className="font-medium">Download SLA</span>
                          <span className="opacity-70">{avgDown} / {slaDown} Mbps min</span>
                        </div>
                      )}
                      {slaUp !== null && avgUp !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          avgUp >= slaUp
                            ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300'
                            : 'bg-red-500/8 border-red-500/25 text-red-300'
                        }`}>
                          <span>{avgUp >= slaUp ? '✓' : '✗'}</span>
                          <span className="font-medium">Upload SLA</span>
                          <span className="opacity-70">{avgUp} / {slaUp} Mbps min</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Outage alert banner */}
            {(outageData?.totalOutages ?? 0) > 0 && (
              <div className="bg-red-950/50 border border-red-500/40 rounded-xl px-4 py-3.5 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-300">
                    {outageData.totalOutages} internet outage{outageData.totalOutages !== 1 ? 's' : ''} detected in this period
                  </p>
                  <p className="text-xs text-red-400/80 mt-0.5">
                    Total downtime: <span className="font-bold text-red-300">{fmtMs(outageData.totalDowntimeMs)}</span>
                    &nbsp;· Longest: <span className="font-bold text-red-300">{fmtMs(outageData.longestMs)}</span>
                    {ispConfig?.name ? <>&nbsp;· ISP: {ispConfig.name} — expected {ispConfig.expected_uptime ?? 100}% uptime</> : <>&nbsp;· Expected uptime: 100%</>}
                  </p>
                </div>
                <button
                  onClick={handleCopyIspReport}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors flex-shrink-0 ${
                    copiedIsp
                      ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-red-600/20 border-red-500/40 text-red-300 hover:bg-red-600/30'
                  }`}
                >
                  {copiedIsp ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedIsp ? 'Copied!' : 'Copy to Clipboard'}
                </button>
              </div>
            )}

            {/* Outage log */}
            {(outageData?.outages?.length ?? 0) > 0 && (
              <div className="bg-[#0a0a18] border border-red-500/20 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-red-500/15">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    <p className="text-xs font-semibold text-red-300">Outage Log</p>
                    <span className="text-[10px] text-slate-500">{outageData.totalOutages} incident{outageData.totalOutages !== 1 ? 's' : ''} · {fmtMs(outageData.totalDowntimeMs)} total downtime</span>
                  </div>
                  <button
                    onClick={handleCopyIspReport}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-lg transition-colors ${
                      copiedIsp
                        ? 'border-emerald-500/40 text-emerald-400'
                        : 'border-[#1a1a30] text-slate-400 hover:text-slate-200 hover:border-[#2a2a45]'
                    }`}
                  >
                    {copiedIsp ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedIsp ? 'Copied!' : 'Copy to Clipboard'}
                  </button>
                </div>
                <div className="overflow-x-auto text-[11px]">
                  <table className="w-full">
                    <thead className="bg-[#08080f]">
                      <tr className="border-b border-[#1a1a30]">
                        <th className="px-4 py-2 text-left text-slate-500 font-medium w-8">#</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium">Started</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium">Restored</th>
                        <th className="px-4 py-2 text-right text-slate-500 font-medium">Down For</th>
                        <th className="px-4 py-2 text-right text-slate-500 font-medium">Was Up For</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#0f0f1c]">
                      {outageData.outages.map((o, i) => (
                        <tr key={i} className={`hover:bg-white/[0.02] ${o.ongoing ? 'bg-red-950/20' : ''}`}>
                          <td className="px-4 py-2 text-slate-600 tabular-nums">{i + 1}</td>
                          <td className="px-4 py-2 text-red-300 tabular-nums whitespace-nowrap">{new Date(o.start).toLocaleString('en-GB')}</td>
                          <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                            {o.ongoing
                              ? <span className="text-red-400 font-semibold">&#9888; Still offline</span>
                              : <span className="text-emerald-400">{new Date(o.end).toLocaleString('en-GB')}</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-bold tabular-nums text-red-300">
                            {fmtMs(o.durationMs)}{o.ongoing ? '+' : ''}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                            {o.uptimeBeforeMs != null ? fmtMs(o.uptimeBeforeMs) : <span className="text-slate-600">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Connectivity chart */}
            {(chartData?.internet?.length ?? 0) > 0 ? (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-slate-400">Latency Over Time</p>
                  {(() => {
                    const last = chartData.internet.at?.(-1)
                    if (!last) return null
                    return (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${last.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {last.ok ? 'Online' : 'Offline'}
                      </span>
                    )
                  })()}
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData.internet} margin={{ top: 2, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                    <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                      tickFormatter={v => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit="ms" />
                    <Tooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                    <Line type="monotone" dataKey="ms" name="Latency" stroke="#38bdf8" dot={false} strokeWidth={1.5} unit="ms" connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-600 text-sm">
                No internet check data for this range
              </div>
            )}

            {/* Checks table */}
            <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
              <p className="text-xs font-medium text-slate-400 mb-3">Recent Checks</p>
              {internetData?.checks?.length > 0 ? (() => {
                const filtered = internetData.checks.filter(c => {
                  if (internetStatusFilter === 'online'  && !c.ok) return false
                  if (internetStatusFilter === 'offline' &&  c.ok) return false
                  if (internetSearch) {
                    const s = internetSearch.toLowerCase()
                    const timeStr = new Date(c.ts).toLocaleString('en-GB').toLowerCase()
                    if (!timeStr.includes(s) && !String(c.avgMs ?? '').includes(s) && !String(c.hostCount ?? '').includes(s)) return false
                  }
                  return true
                })
                return (
                <div className="overflow-x-auto max-h-96 overflow-y-auto text-[11px]">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-[#0a0a18]">
                      <tr className="border-b border-[#1a1a30]">
                        <th className="px-2 py-1.5 text-left text-slate-400">Time</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Status</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Mode</th>
                        <th className="px-2 py-1.5 text-right text-slate-400">Latency</th>
                        <th className="px-2 py-1.5 text-right text-slate-400">Hosts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((check, i) => (
                        <tr key={i} className="border-b border-[#1a1a30] hover:bg-[#15151f]">
                          <td className="px-2 py-1.5 text-slate-400">{new Date(check.ts).toLocaleString('en-GB')}</td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              check.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                            }`}>
                              {check.ok ? 'Online' : 'Offline'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            {check.outage_mode
                              ? <span title={`Fast-polling every ${check.interval_seconds}s (attempt ${check.attempt_count})`}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 cursor-default">
                                  <Zap className="w-2.5 h-2.5" />{check.interval_seconds}s
                                </span>
                              : <span className="text-slate-700 text-[10px]">—</span>
                            }
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{check.avgMs ?? '—'} ms</td>
                          <td className="px-2 py-1.5 text-right text-slate-400">
                            <span className="text-emerald-400">{check.okCount}</span> / {check.hostCount}
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={5} className="px-2 py-6 text-center text-slate-600 text-xs">No checks match the filter</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                )
              })() : (
                <div className="flex items-center justify-center py-8 text-slate-600 text-sm">No check data in this range</div>
              )}
            </div>
          </>
        )}

        {/* ── SPEED TEST ── */}
        {tab === 'speedtest' && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Speed Test History</p>
                <p className="text-[11px] text-slate-500 mt-0.5">via Cloudflare — Download / Upload / Ping</p>
              </div>
              <button onClick={handleRunSpeedtest} disabled={running}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 rounded-lg transition-colors disabled:opacity-40">
                <Zap className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
                {running ? 'Running…' : 'Run Now'}
              </button>
            </div>

            {running && (
              <div className="flex items-center gap-2 text-xs text-indigo-400 bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Speed test in progress — measuring download &amp; upload (~30s)…
              </div>
            )}

            {speedtestData?.results?.length > 0 ? (() => {
              const rows      = speedtestData.results
              const avgDown   = (rows.reduce((s, r) => s + (r.download_mbps ?? 0), 0) / rows.length).toFixed(1)
              const avgUp     = (rows.reduce((s, r) => s + (r.upload_mbps   ?? 0), 0) / rows.length).toFixed(1)
              const latest    = rows[0]
              const planDown  = ispConfig?.plan_download_mbps ?? 0
              const planUp    = ispConfig?.plan_upload_mbps   ?? 0
              const sla       = 0.80
              const belowDown = planDown > 0 ? rows.filter(r => (r.download_mbps ?? 0) < planDown * sla).length : 0
              const belowUp   = planUp   > 0 ? rows.filter(r => (r.upload_mbps   ?? 0) < planUp   * sla).length : 0
              const avgDownPct = planDown > 0 ? Math.round((parseFloat(avgDown) / planDown) * 100) : null
              const avgUpPct   = planUp   > 0 ? Math.round((parseFloat(avgUp)   / planUp)   * 100) : null
              const downColor  = (v) => !planDown ? 'text-emerald-400' : v < planDown * 0.8 ? 'text-red-400' : v < planDown * 0.95 ? 'text-amber-400' : 'text-emerald-400'
              const upColor    = (v) => !planUp   ? 'text-sky-400'     : v < planUp   * 0.8 ? 'text-red-400' : v < planUp   * 0.95 ? 'text-amber-400' : 'text-sky-400'
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      {
                        label: 'Latest Download',
                        value: planDown > 0 ? `${latest.download_mbps} Mbps (${Math.round((latest.download_mbps / planDown) * 100)}%)` : `${latest.download_mbps} Mbps`,
                        color: downColor(latest.download_mbps ?? 0),
                        border: planDown > 0 && (latest.download_mbps ?? 0) < planDown * 0.8 ? 'border-red-500/30' : 'border-[#1a1a30]',
                      },
                      {
                        label: 'Latest Upload',
                        value: planUp > 0 ? `${latest.upload_mbps} Mbps (${Math.round((latest.upload_mbps / planUp) * 100)}%)` : `${latest.upload_mbps} Mbps`,
                        color: upColor(latest.upload_mbps ?? 0),
                        border: planUp > 0 && (latest.upload_mbps ?? 0) < planUp * 0.8 ? 'border-red-500/30' : 'border-[#1a1a30]',
                      },
                      { label: 'Latest Ping',                  value: `${latest.ping_ms} ms`,   color: 'text-violet-400', border: 'border-[#1a1a30]' },
                      { label: `Avg over ${rows.length} tests`, value: `↓${avgDown} ↑${avgUp}`, color: 'text-indigo-400', border: 'border-[#1a1a30]' },
                    ].map(({ label, value, color, border }) => (
                      <div key={label} className={`rounded-xl px-4 py-3 border bg-[#0a0a18] ${border}`}>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                        <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* SLA compliance banner */}
                  {(planDown > 0 || planUp > 0) && (() => {
                    const failing = belowDown > 0 || belowUp > 0
                    return (
                      <div className={`border rounded-xl px-4 py-3.5 flex items-start gap-3 ${failing ? 'bg-red-950/40 border-red-500/30' : 'bg-emerald-950/30 border-emerald-500/20'}`}>
                        <TrendingDown className={`w-4 h-4 flex-shrink-0 mt-0.5 ${failing ? 'text-red-400' : 'text-emerald-400'}`} />
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold ${failing ? 'text-red-300' : 'text-emerald-300'}`}>
                            Plan: {planDown > 0 && planUp > 0 ? `${planDown}/${planUp} Mbps` : planDown > 0 ? `${planDown} Mbps download` : `${planUp} Mbps upload`}
                            {ispConfig?.connection_type ? ` · ${ispConfig.connection_type}` : ''}
                            {ispConfig?.name ? ` · ${ispConfig.name}` : ''}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
                            {planDown > 0 && <span>↓ avg: <span className={`font-semibold ${downColor(parseFloat(avgDown))}`}>{avgDown} Mbps ({avgDownPct}%)</span></span>}
                            {planUp   > 0 && <span>↑ avg: <span className={`font-semibold ${upColor(parseFloat(avgUp))}`}>{avgUp} Mbps ({avgUpPct}%)</span></span>}
                            {planDown > 0 && <span className={belowDown > 0 ? 'text-red-400' : 'text-slate-600'}>{belowDown}/{rows.length} tests below 80% download SLA</span>}
                            {planUp   > 0 && <span className={belowUp   > 0 ? 'text-red-400' : 'text-slate-600'}>{belowUp}/{rows.length} tests below 80% upload SLA</span>}
                          </p>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                    <div className="flex items-start justify-between mb-3">
                      <p className="text-xs font-medium text-slate-400">Download &amp; Upload Trend</p>
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span className="inline-block w-5 border-t-2 border-emerald-500 rounded" />
                          Download
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span className="inline-block w-5 border-t-2 border-sky-400 rounded" />
                          Upload
                        </span>
                        {planDown > 0 && (
                          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400/70">
                            <span className="inline-block w-5 border-t-2 border-dashed border-emerald-500/70" />
                            Plan ↓ {planDown} Mbps
                          </span>
                        )}
                        {planUp > 0 && (
                          <span className="flex items-center gap-1.5 text-[10px] text-sky-400/70">
                            <span className="inline-block w-5 border-t-2 border-dashed border-sky-400/70" />
                            Plan ↑ {planUp} Mbps
                          </span>
                        )}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={[...rows].reverse()} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                        <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                          tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" M" />
                        <Tooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                        <Line type="monotone" dataKey="download_mbps" name="Download" stroke="#10b981" dot={{ r: 3 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                        <Line type="monotone" dataKey="upload_mbps"   name="Upload"   stroke="#38bdf8" dot={{ r: 3 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                        {planDown > 0 && <ReferenceLine y={planDown} stroke="#10b981" strokeDasharray="5 3" strokeOpacity={0.6} label={{ value: `${planDown} Mbps`, fill: '#10b981', fontSize: 9, opacity: 0.8 }} />}
                        {planUp   > 0 && <ReferenceLine y={planUp}   stroke="#38bdf8" strokeDasharray="5 3" strokeOpacity={0.6} label={{ value: `${planUp} Mbps`,   fill: '#38bdf8', fontSize: 9, opacity: 0.8 }} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl overflow-hidden">
                    <div className="overflow-x-auto max-h-96 overflow-y-auto text-[11px]">
                      <table className="w-full min-w-[640px]">
                        <thead className="sticky top-0 bg-[#0a0a18]">
                          <tr className="border-b border-[#1a1a30]">
                            <th className="px-3 py-2 text-left text-slate-400">Time</th>
                            <th className="px-3 py-2 text-right text-slate-400">↓ Down</th>
                            <th className="px-3 py-2 text-right text-slate-400">↑ Up</th>
                            <th className="px-3 py-2 text-right text-slate-400">Ping</th>
                            <th className="px-3 py-2 text-left text-slate-400">ISP</th>
                            <th className="px-3 py-2 text-left text-slate-400">Client IP</th>
                            <th className="px-3 py-2 text-left text-slate-400">Server</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.filter(r => {
                            if (speedtestBelowSla) {
                              const dFail = planDown > 0 && (r.download_mbps ?? 0) < planDown * sla
                              const uFail = planUp   > 0 && (r.upload_mbps   ?? 0) < planUp   * sla
                              if (!dFail && !uFail) return false
                            }
                            if (speedtestSearch) {
                              const s = speedtestSearch.toLowerCase()
                              return (r.server_name ?? r.server_host ?? '').toLowerCase().includes(s) ||
                                     (r.client_isp ?? '').toLowerCase().includes(s) ||
                                     (r.client_ip  ?? '').toLowerCase().includes(s)
                            }
                            return true
                          }).map((r, i) => {
                            const dFail = planDown > 0 && (r.download_mbps ?? 0) < planDown * sla
                            const uFail = planUp   > 0 && (r.upload_mbps   ?? 0) < planUp   * sla
                            return (
                            <tr key={i} className={`border-b border-[#1a1a30] hover:bg-[#15151f] ${dFail || uFail ? 'bg-red-950/20' : ''}`}>
                              <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{fmtDate(r.ts)}</td>
                              <td className={`px-3 py-1.5 text-right font-medium ${downColor(r.download_mbps ?? 0)}`}>
                                {r.download_mbps ?? '—'} Mbps
                                {planDown > 0 && r.download_mbps != null && <span className="text-[9px] text-slate-600 ml-1">({Math.round((r.download_mbps / planDown) * 100)}%)</span>}
                              </td>
                              <td className={`px-3 py-1.5 text-right font-medium ${upColor(r.upload_mbps ?? 0)}`}>
                                {r.upload_mbps ?? '—'} Mbps
                                {planUp > 0 && r.upload_mbps != null && <span className="text-[9px] text-slate-600 ml-1">({Math.round((r.upload_mbps / planUp) * 100)}%)</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-violet-400">{r.ping_ms ?? '—'} ms</td>
                              <td className="px-3 py-1.5 text-slate-400 max-w-[140px] truncate">{r.client_isp ?? '—'}</td>
                              <td className="px-3 py-1.5 text-slate-500 font-mono">{r.client_ip ?? '—'}</td>
                              <td className="px-3 py-1.5 text-slate-500 truncate max-w-[160px]">{String(r.server_name ?? r.server_host ?? '—').replace(' [object Object]', '')}</td>
                            </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )
            })() : (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-slate-600">
                <Zap className="w-8 h-8 opacity-30" />
                <p className="text-sm">No speed tests in this range</p>
                <button onClick={handleRunSpeedtest} disabled={running}
                  className="mt-1 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 rounded-lg transition-colors disabled:opacity-40">
                  <Zap className="w-3.5 h-3.5" />
                  Run First Test
                </button>
              </div>
            )}
          </>
        )}

        {/* ── ACTIVITY ── */}
        {tab === 'activity' && (
          <>
            {/* Event table */}
            <div ref={tableRef} className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a30]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">Events</span>
                  <span className="text-xs text-slate-500">{total.toLocaleString()} total</span>
                  {drillDay && (
                    <span className="flex items-center gap-1 bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-[11px] px-2 py-0.5 rounded-full">
                      {drillDay.label}
                      <button onClick={clearDrilldown} className="hover:text-white ml-0.5"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  )}
                </div>
                {totalPages > 1 && (
                  <Pagination page={page} totalPages={totalPages} onPage={setPage} />
                )}
              </div>

              {loading && !events.length ? (
                <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : !events.length ? (
                <div className="flex items-center justify-center py-16 text-slate-600 text-sm">No events in this range</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#1a1a30]">
                        <th className="px-4 py-2 text-left text-slate-500 font-medium w-36">Time</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium w-44">Event</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium w-24">Duration</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#0f0f20]">
                      {events
                        .filter(ev => {
                          if (!activitySearch) return true
                          const s = activitySearch.toLowerCase()
                          const p = ev.payload ? (typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)) : ''
                          return ev.event?.toLowerCase().includes(s) || p.toLowerCase().includes(s)
                        })
                        .map((ev, i) => (
                        <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-2 text-slate-500 tabular-nums whitespace-nowrap">{fmtDate(ev.ts)}</td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${evColor(ev.event)}`}>
                              {ev.event}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-mono tabular-nums whitespace-nowrap text-slate-400">
                            {fmtDuration(ev.payload) ?? <span className="text-slate-700">—</span>}
                          </td>
                          <td className="px-4 py-2 text-slate-400 max-w-xs truncate">{fmtPayload(ev.event, ev.payload)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
