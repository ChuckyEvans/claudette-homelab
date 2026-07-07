import { useState, useEffect, useCallback, useRef } from 'react'
import { BarChart2, RefreshCw, X, Monitor, Activity, Server, Wifi, Download, Clock, Zap, Search, AlertTriangle, Copy, Check, TrendingDown, ClipboardCheck, Shield, Loader2, ChevronDown, Globe } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend,
  ResponsiveContainer, LineChart, Line, ReferenceLine,
} from 'recharts'
import { api, exportToCsv, exportToPdf } from '../lib/api.js'
import MiniSpeedGauges from './MiniSpeedGauges.jsx'
import Pagination from './Pagination.jsx'
// TopProgressBar removed for speedtest UI — gauges now animate in-place
import Tooltip from './Tooltip.jsx'

const PAGE_SIZE = 50

// ── Lightweight toast ─────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([])
  const add = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])
  return { toasts, add }
}

function ToastStack({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur-sm animate-[fadeSlideUp_0.2s_ease-out] ${
            t.type === 'error'
              ? 'bg-red-950/95 border-red-500/30 text-red-300'
              : 'bg-emerald-950/95 border-emerald-500/30 text-emerald-300'
          }`}>
          {t.type === 'error'
            ? <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            : <ClipboardCheck className="w-4 h-4 flex-shrink-0" />}
          {t.message}
        </div>
      ))}
    </div>
  )
}

function EvidenceList({ outage }) {
  const [files, setFiles] = useState([])
  useEffect(() => { if (!outage) return; fetch(`/api/reports/outages/${outage.start}/evidence`).then(r=>r.json()).then(j=>setFiles(j.files||[])).catch(()=>{}) }, [outage])
  if (!outage) return null
  return (
    <div className="mt-2">
      <div className="text-sm font-medium">Evidence</div>
      <ul className="mt-1 space-y-1 text-sm">
        {files.length === 0 ? <li className="text-slate-400">No files</li> : files.map(f => (
          <li key={f.id} className="flex items-center gap-2">
            <a className="text-sky-400 underline" href={`/api/reports/outages/${outage.start}/evidence/${f.id}/download`}>{f.filename}</a>
            <span className="text-xs text-slate-400">{new Date(f.uploaded_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const CHART_PALETTE = { new: '#10b981', online: '#38bdf8', offline: '#64748b', ports: '#818cf8' }

// Known port → service name. Ports > 1024 get a "?" suffix (unofficial/common).
const PORT_NAMES = {
  // Well-known (≤1024)
  20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp',
  53: 'dns', 67: 'dhcp', 68: 'dhcp', 69: 'tftp', 80: 'http',
  110: 'pop3', 111: 'rpcbind', 119: 'nntp', 123: 'ntp',
  135: 'msrpc', 137: 'netbios', 138: 'netbios', 139: 'netbios',
  143: 'imap', 161: 'snmp', 162: 'snmp', 179: 'bgp', 194: 'irc',
  389: 'ldap', 443: 'https', 445: 'smb', 465: 'smtps',
  500: 'ipsec', 514: 'syslog', 515: 'printer', 554: 'rtsp', 587: 'smtp',
  631: 'ipp', 636: 'ldaps', 993: 'imaps', 995: 'pop3s',
  // Registered / common high ports
  1080: 'socks', 1194: 'openvpn', 1433: 'mssql', 1521: 'oracle',
  1900: 'ssdp',
  1883: 'mqtt', 2049: 'nfs', 2375: 'docker', 2376: 'docker-tls',
  3000: 'dev-http', 3306: 'mysql', 3389: 'rdp', 3478: 'stun',
  4000: 'alt-http', 4443: 'https-alt', 5000: 'upnp', 5001: 'alt-http',
  5432: 'postgres', 5900: 'vnc', 6379: 'redis', 6443: 'k8s-api',
  7654: 'claudette', 8080: 'http-alt', 8081: 'http-alt',
  8123: 'home-asst', 8191: 'flaresolverr', 8443: 'https-alt',
  8888: 'jupyter', 9000: 'php-fpm', 9090: 'prometheus', 9091: 'transmission',
  9092: 'kafka', 9117: 'jackett', 9200: 'elasticsearch',
  27017: 'mongodb', 32400: 'plex', 51820: 'wireguard',
}

function portLabel(port) {
  const n = parseInt(port, 10)
  const name = PORT_NAMES[n]
  if (!name) return String(port)
  return n > 1024 ? `${port} · ${name}?` : `${port} · ${name}`
}

function rangeMs(key) {
  const map = { '1h': 3_600_000, '3h': 10_800_000, '1d': 86_400_000, '7d': 7*86_400_000, '30d': 30*86_400_000, '90d': 90*86_400_000, '1y': 365*86_400_000 }
  return map[key] ?? 86_400_000
}

const RANGE_OPTS   = ['1h', '3h', '1d', '7d', '30d', '90d', '1y', 'custom']
const RANGE_LABELS = { '1h': '1h', '3h': '3h', '1d': '1d', '7d': '7d', '30d': '30d', '90d': '90d', '1y': '1y', custom: 'Custom' }
const RANGE_TIPS   = { '1h': 'Last 1 hour', '3h': 'Last 3 hours', '1d': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '1y': 'Last year', custom: 'Pick a custom date range' }

const EV_FILTERS = [
  { label: 'All',      value: '' },
  { label: 'Devices',  value: 'device' },
  { label: 'Services', value: 'service' },
  { label: 'Scans',    value: 'scan' },
  { label: 'Threats',  value: 'threat' },
  { label: 'Internet', value: 'internet' },
]

const EV_META = {
  'device.new':         { label: 'New Device',      color: 'text-emerald-400 bg-emerald-500/10' },
  'device.online':      { label: 'Device Online',   color: 'text-sky-400     bg-sky-500/10'     },
  'device.offline':     { label: 'Device Offline',  color: 'text-slate-400   bg-white/5'        },
  'device.port.open':   { label: 'Port Opened',     color: 'text-indigo-400  bg-indigo-500/10'  },
  'service.down':       { label: 'Service Down',    color: 'text-red-400     bg-red-500/10'     },
  'service.up':         { label: 'Service Up',      color: 'text-emerald-400 bg-emerald-500/10' },
  'internet.down':      { label: 'Internet Down',   color: 'text-red-400     bg-red-500/10'     },
  'internet.up':        { label: 'Internet Up',     color: 'text-emerald-400 bg-emerald-500/10' },
  'internet.check':     { label: 'Net Check',       color: 'text-sky-300     bg-sky-500/5'      },
  'scan.complete':      { label: 'Scan Complete',   color: 'text-indigo-400  bg-indigo-500/10'  },
  'scan.started':       { label: 'Scan Started',    color: 'text-indigo-300  bg-indigo-500/8'   },
  'scan.blocked':       { label: 'Scan Blocked',    color: 'text-amber-400   bg-amber-500/10'   },
  'scan.error':         { label: 'Scan Error',      color: 'text-red-400     bg-red-500/10'     },
  'threat.found':       { label: 'Threat Found',    color: 'text-amber-400   bg-amber-500/10'   },
  'threat.refresh':     { label: 'Threat Refresh',  color: 'text-amber-300   bg-amber-500/5'    },
  'service.check':      { label: 'Service Check',   color: 'text-slate-400   bg-white/5'        },
  'config.saved':       { label: 'Config Saved',    color: 'text-violet-400  bg-violet-500/10'  },
  'device.ports_cleared': { label: 'Ports Cleared', color: 'text-slate-400   bg-white/5'        },
}
function evColor(ev) { return (EV_META[ev]?.color) ?? 'text-slate-400 bg-white/5' }
function evLabel(ev) { return (EV_META[ev]?.label) ?? ev }

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

function fmtPayload(evName, payload, row) {
  if (!payload && !row) return null
  const p = !payload ? {}
    : typeof payload === 'string' ? (() => { try { return JSON.parse(payload) } catch { return {} } })()
    : payload

  // Device events — show hostname / IP / MAC prominently
  if (evName === 'device.new') {
    const parts = []
    if (row?.hostname) parts.push(row.hostname)
    if (row?.ip)       parts.push(row.ip)
    if (row?.mac)      parts.push(row.mac)
    if (p.vendor)      parts.push(p.vendor)
    return parts.join(' · ') || null
  }
  if (evName === 'device.online' || evName === 'device.offline') {
    const parts = []
    if (row?.hostname) parts.push(row.hostname)
    if (row?.ip)       parts.push(row.ip)
    return parts.join(' · ') || null
  }
  if (evName === 'device.port.open') {
    const parts = []
    if (row?.hostname || row?.ip) parts.push(row.hostname ?? row.ip)
    if (p.port)    parts.push(`port ${p.port}`)
    if (p.service) parts.push(p.service)
    if (p.version) parts.push(p.version)
    return parts.join(' · ') || null
  }

  // Service events
  if (evName === 'service.down' || evName === 'service.up') {
    const parts = []
    if (p.name)    parts.push(p.name)
    if (p.message) parts.push(p.message)
    return parts.join(' — ') || null
  }
  if (evName === 'service.check') {
    return `${p.up ?? 0} up · ${p.down ?? 0} down · ${p.total ?? 0} total`
  }

  // Internet / connectivity events
  if (evName === 'internet.down') {
    const type = p.outage_type
    const gwOk = p.gateway_ok
    if (type === 'isp')   return 'ISP failure — gateway reachable, external DNS unreachable'
    if (type === 'infra') return 'Infrastructure failure — gateway unreachable'
    if (type === 'unknown') return gwOk == null ? 'Connectivity lost' : 'Connectivity lost (unknown type)'
    return 'Connectivity lost'
  }
  if (evName === 'internet.up') {
    return 'Connectivity restored'
  }
  if (evName === 'internet.check') {
    if (!p.results?.length) return p.ok ? 'Online' : 'Offline'
    const hosts = p.results.map(r => `${r.host.replace(/^https?:\/\//, '')} ${r.ok ? `${r.ms}ms` : '✗'}`).join(' · ')
    const vpn = p.vpn_up ? (p.vpn_ok ? ' · VPN ✓' : ' · VPN ✗') : ''
    return (p.ok ? '✓ ' : '✗ ') + hosts + vpn
  }

  // Scan events
  if (evName === 'scan.complete') {
    const parts = [`${p.devices_found ?? 0} devices`]
    if (p.subnets?.length) parts.push(p.subnets.join(', '))
    return parts.join(' on ')
  }
  if (evName === 'scan.started') {
    return p.subnets?.join(', ') ?? null
  }
  if (evName === 'scan.blocked') {
    return [p.subnet, p.reason].filter(Boolean).join(' — ')
  }
  if (evName === 'scan.error') {
    return p.error ?? 'Unknown error'
  }

  // Threat events
  if (evName === 'threat.refresh' || evName === 'threat.found') {
    const parts = []
    if (p.new_count != null) parts.push(`${p.new_count} new`)
    if (p.total     != null) parts.push(`${p.total} total`)
    return parts.join(', ') || null
  }

  // Config
  if (evName === 'config.saved') return p.section ? `section: ${p.section}` : 'Settings updated'

  // Fallback — render known fields intelligently
  const parts = []
  if (p.hostname) parts.push(p.hostname)
  if (p.ip)       parts.push(p.ip)
  if (p.name)     parts.push(p.name)
  if (p.message)  parts.push(p.message)
  if (p.error)    parts.push(p.error)
  if (parts.length) return parts.join(' · ')
  const str = JSON.stringify(p)
  return str === '{}' ? null : str.slice(0, 120)
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

// ── mtr output parser + hop table ───────────────────────────────────────────
function parseMtrHops(text) {
  if (!text) return null
  const hops = []
  const lines = text.split('\n')
  const re = /^\s*(\d+)\s+([^\s]+)\s+([\d.]+)%?\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+.*)?$/
  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    try {
      hops.push({
        hop: parseInt(m[1]),
        host: m[2],
        loss: parseFloat(m[3]),
        snt: parseInt(m[4]),
        last: parseFloat(m[5]),
        avg: parseFloat(m[6]),
        best: parseFloat(m[7]),
        wrst: parseFloat(m[8]),
        stdev: parseFloat(m[9]),
      })
    } catch (err) { void err }
  }
  return hops.length >= 1 ? hops : null
}

function latencyStyle(ms) {
  if (ms < 10)  return { dot: 'bg-emerald-500 border-emerald-400', badge: 'text-emerald-300', bar: 'bg-emerald-500' }
  if (ms < 30)  return { dot: 'bg-sky-500 border-sky-400',         badge: 'text-sky-300',     bar: 'bg-sky-500'     }
  if (ms < 80)  return { dot: 'bg-amber-500 border-amber-400',     badge: 'text-amber-300',   bar: 'bg-amber-500'   }
  return              { dot: 'bg-red-500 border-red-400',           badge: 'text-red-300',     bar: 'bg-red-500'     }
}

function MtrPathView({ hops }) {
  const dest = hops[hops.length - 1]
  const totalAvg = dest?.avg ?? 0
  const anyLoss = hops.some(h => h.loss > 0)
  const intermediatHops = hops.slice(0, -1)
  return (
    <div className="bg-[#080810] border border-[#1a1a30] rounded-xl px-4 py-4">
      {/* Route summary */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#1a1a30]">
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="text-indigo-300 font-semibold">Pi</span>
          <span className="text-slate-500">→</span>
          <span className="text-emerald-300 font-semibold">8.8.8.8</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-slate-500">{hops.length} hops</span>
          <span className={`font-mono font-semibold ${latencyStyle(totalAvg).badge}`}>{totalAvg.toFixed(1)}ms total</span>
          {anyLoss && <span className="text-red-400 font-semibold">packet loss</span>}
        </div>
      </div>

      {/* Source node */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-full bg-indigo-500/20 border-2 border-indigo-400 flex items-center justify-center flex-shrink-0">
          <Server className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div>
          <div className="text-xs font-semibold text-indigo-300">Pi (source)</div>
          <div className="text-[10px] text-slate-500">origin</div>
        </div>
      </div>

      {/* Intermediate hops */}
      {intermediatHops.map((h) => {
        const s = latencyStyle(h.avg)
        const barWidth = Math.min(100, Math.max(4, (h.avg / 200) * 100))
        return (
          <div key={h.hop}>
            <div className="flex items-stretch gap-3">
              <div className="w-8 flex justify-center"><div className="w-px bg-slate-700 flex-1" /></div>
              <div className="flex items-center gap-2 py-1">
                <div className="h-1.5 rounded-full bg-slate-800 w-20 overflow-hidden">
                  <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${barWidth}%` }} />
                </div>
                <span className={`text-[10px] font-mono ${s.badge}`}>{h.avg.toFixed(1)}ms</span>
                {h.loss > 0 && <span className="text-[10px] text-red-400 font-mono">{h.loss.toFixed(1)}% loss</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 bg-[#0d0d20] ${s.dot}`}>
                <span className="text-[10px] font-bold text-slate-300">{h.hop}</span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-mono truncate text-slate-300">{h.host}</div>
                <div className="text-[10px] text-slate-500">best {h.best.toFixed(1)} · worst {h.wrst.toFixed(1)}ms · {h.snt} probes</div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Final connector to destination */}
      {dest ? (
        (() => {
          const s = latencyStyle(dest.avg)
          const barWidth = Math.min(100, Math.max(4, (dest.avg / 200) * 100))
          return (
            <>
              <div className="flex items-stretch gap-3">
                <div className="w-8 flex justify-center"><div className="w-px bg-emerald-700/50 flex-1" /></div>
                <div className="flex items-center gap-2 py-1">
                  <div className="h-1.5 rounded-full bg-slate-800 w-20 overflow-hidden">
                    <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${barWidth}%` }} />
                  </div>
                  <span className={`text-[10px] font-mono ${s.badge}`}>{dest.avg.toFixed(1)}ms</span>
                  {dest.loss > 0 && <span className="text-[10px] text-red-400 font-mono">{dest.loss.toFixed(1)}% loss</span>}
                </div>
              </div>
              {/* Destination terminal node */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center flex-shrink-0">
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="flex-1 flex items-center justify-between min-w-0">
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-semibold text-emerald-300">{dest.host}</div>
                    <div className="text-[10px] text-slate-500">best {dest.best.toFixed(1)} · worst {dest.wrst.toFixed(1)}ms · hop {dest.hop}</div>
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-500 ml-2 flex-shrink-0">destination reached</span>
                </div>
              </div>
            </>
          )
        })()
      ) : null}
      </div>
    )
}

function MtrTable({ output }) {
  const [view, setView] = useState('path')
  const hops = parseMtrHops(output)
  if (!hops) {
    return (
      <pre className="bg-[#080810] border border-[#1a1a30] rounded-xl px-4 py-3 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre leading-relaxed max-h-64 overflow-y-auto">{output}</pre>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-end gap-1 mb-2">
        <button onClick={() => setView('path')}  className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${view === 'path'  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'text-slate-500 border-[#1a1a30] hover:text-slate-300'}`}>Path</button>
        <button onClick={() => setView('table')} className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${view === 'table' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'text-slate-500 border-[#1a1a30] hover:text-slate-300'}`}>Table</button>
      </div>
      {view === 'path' ? <MtrPathView hops={hops} /> : (
        <div className="rounded-xl overflow-hidden border border-[#1a1a30]">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-[#1a1a30] bg-[#0a0a1a]">
                <th className="px-3 py-1.5 text-left text-slate-500 font-medium">#</th>
                <th className="px-3 py-1.5 text-left text-slate-500 font-medium">IP / Host</th>
                <th className="px-3 py-1.5 text-right text-slate-500 font-medium">Loss</th>
                <th className="px-3 py-1.5 text-right text-slate-500 font-medium">Avg ms</th>
                <th className="px-3 py-1.5 text-right text-slate-500 font-medium">Best</th>
                <th className="px-3 py-1.5 text-right text-slate-500 font-medium">Worst</th>
              </tr>
            </thead>
            <tbody>
              {hops.map((h, i) => (
                <tr key={h.hop} className="border-b border-[#1a1a30] last:border-0 bg-[#080810] hover:bg-[#0d0d20] transition-colors">
                  <td className="px-3 py-1.5 text-slate-500">{h.hop}</td>
                  <td className={`px-3 py-1.5 ${i === hops.length - 1 ? 'text-emerald-400 font-semibold' : 'text-slate-300'}`}>{h.host}</td>
                  <td className={`px-3 py-1.5 text-right ${h.loss > 0 ? 'text-red-400' : 'text-slate-500'}`}>{h.loss.toFixed(1)}%</td>
                  <td className="px-3 py-1.5 text-right text-sky-300">{h.avg.toFixed(1)}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-400">{h.best.toFixed(1)}</td>
                  <td className="px-3 py-1.5 text-right text-amber-400">{h.wrst.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Outage-specific traceroute view ─────────────────────────────────────────
function isPrivateIp(host) {
  if (!host || host === '???') return false
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)
}

function OutageMtrPath({ hops, outageType }) {
  const reachable    = hops.filter(h => h.loss < 100 && h.host !== '???')
  const lastReachable = reachable[reachable.length - 1] ?? null
  const firstDead    = hops.find(h => h.loss >= 100 || h.host === '???')
  const reachedCount = reachable.length

  let stopLabel = 'stopped'
  if (reachedCount === 0) stopLabel = 'local down'
  else if (isPrivateIp(lastReachable?.host)) stopLabel = 'stopped in LAN'
  else stopLabel = 'stopped at ISP'

  return (
    <div className="bg-[#080810] border border-[#1a1a30] rounded-xl px-4 py-4">
      {/* Summary */}
      <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-[#1a1a30]">
        <div>
          {lastReachable ? (
            <>
              <p className="text-[11px] text-slate-300">
                Furthest reached:
                <span className="font-mono text-emerald-400 ml-1">hop {lastReachable.hop} · {lastReachable.host}</span>
                {isPrivateIp(lastReachable.host) && <span className="ml-1.5 text-[10px] text-slate-500">(local network)</span>}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {reachedCount} of {hops.length} traced hop{hops.length !== 1 ? 's' : ''} responded
                {firstDead && ` · packets stopped at hop ${firstDead.hop}`}
                {outageType === 'infra' && reachedCount <= 1 ? ' — local router/switch issue' : ''}
              </p>
            </>
          ) : (
            <p className="text-[11px] font-semibold text-red-400">No hops reached · local network unreachable</p>
          )}
        </div>
        <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${
          reachedCount === 0 ? 'bg-red-500/15 border-red-500/30 text-red-400' :
          isPrivateIp(lastReachable?.host) ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
          'bg-orange-500/10 border-orange-500/30 text-orange-400'
        }`}>{stopLabel}</span>
      </div>

      {/* Vertical path */}
      <div>
        {/* Source */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-indigo-500/20 border-2 border-indigo-400 flex items-center justify-center flex-shrink-0">
            <Server className="w-3 h-3 text-indigo-400" />
          </div>
          <span className="text-[11px] font-semibold text-indigo-300">Pi (source)</span>
        </div>

        {hops.map((h) => {
          const isDead       = h.loss >= 100 || h.host === '???'
          const isLast       = lastReachable?.hop === h.hop
          const isFirstDead  = firstDead?.hop === h.hop
          return (
            <div key={h.hop}>
              {/* Connector line */}
              <div className="flex items-stretch gap-3">
                <div className="w-7 flex justify-center">
                  <div className={`w-px flex-1 ${isDead ? 'bg-red-800/40' : 'bg-slate-700'}`} />
                </div>
                <div className={`flex items-center gap-1.5 py-0.5 text-[10px] font-mono ${isDead ? 'text-red-800' : 'text-slate-500'}`}>
                  {isDead ? '×' : `${h.avg.toFixed(1)}ms`}
                  {isLast && <span className="text-emerald-600 text-[9px] font-semibold uppercase tracking-wide ml-1">← last reached</span>}
                </div>
              </div>
              {/* Dead-zone separator */}
              {isFirstDead && (
                <div className="flex items-center gap-2 my-1.5 ml-10">
                  <div className="flex-1 h-px bg-red-700/30" />
                  <span className="text-[10px] text-red-500/80 font-semibold whitespace-nowrap">no response beyond here</span>
                  <div className="flex-1 h-px bg-red-700/30" />
                </div>
              )}
              {/* Hop node */}
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  isDead ? 'bg-red-950/30 border-red-800/50' :
                  isLast ? 'bg-emerald-500/15 border-emerald-500' :
                  'bg-[#0d0d20] border-slate-700'
                }`}>
                  {isDead
                    ? <span className="text-[9px] text-red-600 font-bold">✗</span>
                    : <span className="text-[9px] text-slate-400 font-bold">{h.hop}</span>}
                </div>
                <div className="min-w-0">
                  <div className={`text-[11px] font-mono ${
                    isDead ? 'text-red-700' : isLast ? 'text-emerald-400 font-semibold' : 'text-slate-300'
                  }`}>
                    {h.host === '???' ? '??? (no response)' : h.host}
                    {!isDead && isPrivateIp(h.host) && <span className="ml-1.5 text-[10px] text-slate-500">local</span>}
                  </div>
                  {!isDead && (
                    <div className="text-[10px] text-slate-500">
                      avg {h.avg.toFixed(1)} · best {h.best.toFixed(1)} · worst {h.wrst.toFixed(1)}ms · {h.loss.toFixed(1)}% loss
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Destination — always unreachable during an outage */}
        <div className="flex items-stretch gap-3">
          <div className="w-7 flex justify-center"><div className="w-px flex-1 bg-red-800/30" /></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-red-950/20 border-2 border-red-800/40 flex items-center justify-center flex-shrink-0">
            <Wifi className="w-3 h-3 text-red-700" />
          </div>
          <div>
            <div className="text-[11px] font-mono text-red-600">8.8.8.8 (destination)</div>
            <div className="text-[10px] text-red-800">unreachable during outage</div>
          </div>
        </div>
        
      </div>
    </div>
  )
}

function OutageMtrView({ output, outageType }) {
  const hops = parseMtrHops(output)
  if (!hops) {
    return (
      <pre className="bg-[#080810] border border-[#1a1a30] rounded-xl px-4 py-3 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre leading-relaxed max-h-64 overflow-y-auto">{output || 'No traceroute data'}</pre>
    )
  }
  return <OutageMtrPath hops={hops} outageType={outageType} />
}

// ── Multi-select dropdown ─────────────────────────────────────────────────────
function MultiSelectDropdown({ label, options, selected, onApply, className }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(new Set(selected))
  const ref = useRef(null)
  useEffect(() => { setPending(new Set(selected)) }, [selected])
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  function toggle(v) { setPending(p => { const s = new Set(p); s.has(v) ? s.delete(v) : s.add(v); return s }) }
  function apply() { onApply([...pending]); setOpen(false) }
  function clear()  { setPending(new Set()); onApply([]); setOpen(false) }
  const count = selected.length
  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        onClick={() => { setPending(new Set(selected)); setOpen(v => !v) }}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
          count > 0
            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
            : 'border-[#1a1a30] text-slate-400 hover:text-slate-200'
        }`}
      >
        {label}
        {count > 0 && <span className="bg-indigo-500/40 text-indigo-200 rounded px-1 text-[10px]">{count}</span>}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-[#0d0d20] border border-[#1a1a35] rounded-xl shadow-2xl min-w-[200px] max-w-[280px]">
          <div className="max-h-52 overflow-y-auto p-2 space-y-0.5">
            {options.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer">
                <input type="checkbox" checked={pending.has(opt.value)} onChange={() => toggle(opt.value)} className="w-3.5 h-3.5 accent-indigo-500" />
                <span className="text-xs text-slate-300 truncate">{opt.label}</span>
              </label>
            ))}
            {options.length === 0 && <p className="text-xs text-slate-500 px-2 py-1">No options</p>}
          </div>
          <div className="flex gap-2 px-3 py-2 border-t border-[#1a1a30]">
            <button onClick={apply} className="flex-1 px-2 py-1 text-xs bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/40 rounded-lg transition-colors">OK</button>
            <button onClick={clear} className="px-2 py-1 text-xs border border-[#1a1a30] text-slate-500 hover:text-slate-300 rounded-lg transition-colors">Clear all</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Check detail modal ───────────────────────────────────────────────────────
function CheckDetailModal({ check, onClose, onTraceStart, onTraceEnd }) {
  const [traceroute, setTraceroute] = useState(null)
  const [tracing,    setTracing]    = useState(false)
  const [traceError, setTraceError] = useState(null)

  async function runTraceroute() {
    setTracing(true)
    setTraceError(null)
    onTraceStart?.()
    try {
      const data = await api.reports.runTraceroute()
      setTraceroute(data.output)
    } catch (e) {
      setTraceError(e.message || 'Traceroute failed')
    } finally {
      setTracing(false)
      onTraceEnd?.()
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative bg-[#0d0d1a] border border-[#1a1a35] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a30]">
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
              check.ok
                ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                : 'bg-red-500/15 text-red-400 border-red-500/20'
            }`}>{check.ok ? 'Online' : 'Offline'}</span>
            <span className="text-slate-300 text-sm font-medium">
              {new Date(check.ts).toLocaleString('en-GB')}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Summary row */}
          <div className="flex flex-wrap gap-6 text-xs">
            {check.gateway && (
              <div>
                <p className="text-slate-500 uppercase tracking-wide mb-0.5">Gateway</p>
                <p className="text-slate-200 font-mono">{check.gateway}</p>
              </div>
            )}
            {check.avgMs != null && (
              <div>
                <p className="text-slate-500 uppercase tracking-wide mb-0.5">Direct Avg</p>
                <p className="text-sky-300 font-mono">{check.avgMs} ms</p>
              </div>
            )}
            {check.vpn_up && check.vpnAvgMs != null && (
              <div>
                <p className="text-slate-500 uppercase tracking-wide mb-0.5">VPN Avg</p>
                <p className="text-violet-300 font-mono">{check.vpnAvgMs} ms</p>
              </div>
            )}
            {check.outage_type && (
              <div>
                <p className="text-slate-500 uppercase tracking-wide mb-0.5">Outage Type</p>
                <p className={`font-medium ${
                  check.outage_type === 'isp' ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {check.outage_type === 'isp' ? 'ISP (gateway ok)' : 'Infrastructure (gateway down)'}
                </p>
              </div>
            )}
          </div>

          {/* Per-host ping results */}
          {check.hosts?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">Ping Results</p>
              <div className="rounded-lg overflow-hidden border border-[#1a1a30]">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-[#0a0a18] border-b border-[#1a1a30]">
                      <th className="px-3 py-2 text-left text-slate-500">Host</th>
                      <th className="px-3 py-2 text-center text-slate-500">Status</th>
                      <th className="px-3 py-2 text-right text-slate-500">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.hosts.map((h, i) => (
                      <tr key={i} className="border-b border-[#1a1a30] last:border-0">
                        <td className="px-3 py-2 text-slate-300 font-mono">{h.host}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            h.ok ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                          }`}>{h.ok ? 'OK' : 'FAIL'}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400 font-mono">
                          {h.ms != null ? `${h.ms} ms` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VPN hosts */}
          {check.vpn_up && check.vpnHosts?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-violet-400 mb-2">VPN Ping Results</p>
              <div className="rounded-lg overflow-hidden border border-violet-500/20">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-violet-500/5 border-b border-violet-500/20">
                      <th className="px-3 py-2 text-left text-slate-500">Host</th>
                      <th className="px-3 py-2 text-center text-slate-500">Status</th>
                      <th className="px-3 py-2 text-right text-slate-500">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.vpnHosts.map((h, i) => (
                      <tr key={i} className="border-b border-violet-500/15 last:border-0">
                        <td className="px-3 py-2 text-slate-300 font-mono">{h.host}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            h.ok ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                          }`}>{h.ok ? 'OK' : 'FAIL'}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-violet-300 font-mono">
                          {h.ms != null ? `${h.ms} ms` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Live traceroute */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-400">Live Traceroute to 8.8.8.8</p>
              <button
                onClick={runTraceroute}
                disabled={tracing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {tracing
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Activity className="w-3.5 h-3.5" />}
                {tracing ? 'Running…' : 'Run Traceroute'}
              </button>
            </div>
            {tracing && (
              <div className="rounded-lg bg-[#0a0a18] border border-[#1a1a30] p-3 space-y-1.5 overflow-hidden">
                {[80,60,70,50,65].map((w,i) => (
                  <div key={i} className="h-2.5 rounded bg-slate-800 overflow-hidden" style={{width:`${w}%`}}>
                    <div className="h-full bg-gradient-to-r from-transparent via-slate-600 to-transparent animate-[shimmer_1.5s_infinite]" style={{animationDelay:`${i*0.15}s`}} />
                  </div>
                ))}
              </div>
            )}
            {traceError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{traceError}</p>
            )}
            {traceroute && <MtrTable output={traceroute} />}
            {!traceroute && !traceError && !tracing && (
              <p className="text-xs text-slate-500 italic">Click &ldquo;Run Traceroute&rdquo; to probe the current network path from the Pi</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const ALL_TABS = [
  { id: 'overview',  label: 'Overview',   Icon: BarChart2, tip: 'Summary: network activity, connectivity and device events' },
  { id: 'internet',  label: 'Internet',   Icon: Wifi,      tip: 'Internet connectivity checks, latency trends and outage history' },
  { id: 'vpn',       label: 'VPN',        Icon: Shield,    tip: 'VPN uptime, latency and connection checks via your VPN interface' },
  { id: 'speedtest', label: 'Speed Test', Icon: Zap,       tip: 'Broadband speed test history — download, upload and ping' },
  { id: 'ddns',      label: 'DDNS',       Icon: Globe,     tip: 'Dynamic DNS hostname tracking and public IP change history' },
  { id: 'activity',  label: 'Activity',   Icon: Activity,  tip: 'Full event log — device changes, scans, service alerts and more' },
]

export default function Reports() {
  const [_per, _setPer] = useState(25) // unused per-state stub

  const [tab,          setTab]          = useState('overview')
  const [range,        setRange]        = useState('30d')
  const [eventFilter,  setEventFilter]  = useState('')
  const [macFilter,    setMacFilter]    = useState([])
  const [subnetFilter, setSubnetFilter] = useState('')
  const [page,         setPage]         = useState(0)
  const [activitySearch, setActivitySearch] = useState('')
  const [data,         setData]         = useState(null)
  const [chartData,    setChartData]    = useState(null)
  const [devices,      setDevices]      = useState([])
  const [subnets,      setSubnets]      = useState([])
  const [ispConfig,    setIspConfig]    = useState({})
  const [infraConfig,  setInfraConfig]  = useState({})
  const [loading,      setLoading]      = useState(false)
  const [drillDay,     setDrillDay]     = useState(null) // { from, to, label }
  const [internetData,  setInternetData]  = useState(null)
  const [speedtestData, setSpeedtestData] = useState(null)
  const [speedLatest, setSpeedLatest] = useState(null)
  const [exporting,     setExporting]     = useState(null)
  const [running,       setRunning]       = useState(false)
  const [runningVpn,    setRunningVpn]    = useState(false)
  const [manualActive,  setManualActive]  = useState(false)
  const [outageData,    setOutageData]    = useState(null)
  const [outageLogPage, setOutageLogPage] = useState(1)
  const [outageLogPer, setOutageLogPer] = useState(25)
  const [outageLog,     setOutageLog]     = useState([])
  const [outageLogTotal, setOutageLogTotal] = useState(0)
  const [_outageLogLoading, setOutageLogLoading] = useState(false)
  const [outageLogOrderColumn] = useState('captured_at')
  const [outageLogOrderDir, setOutageLogOrderDir] = useState('desc')
  const [copiedIsp,     setCopiedIsp]     = useState(false)
  const [networkConfig, setNetworkConfig] = useState({})
  const [speedtestProvider, setSpeedtestProvider] = useState('cloudflare')
  const [vpnMeta,       setVpnMeta]       = useState(null)
  const [internetStatusFilter, setInternetStatusFilter] = useState('') // '' | 'online' | 'offline' | 'isp' | 'infra'
  const [internetSearch,       setInternetSearch]       = useState('')
  const [speedtestSearch,      setSpeedtestSearch]      = useState('')
  const [speedtestBelowSla,    setSpeedtestBelowSla]    = useState(false)
  const [speedtestServerFilter, setSpeedtestServerFilter] = useState([])
  const [speedChartType,       setSpeedChartType]       = useState('line')
  const [customRange,          setCustomRange]          = useState(null) // { from, to } ms — applied custom range
  const [customPickerOpen,     setCustomPickerOpen]     = useState(false)
  const [inputFrom,            setInputFrom]            = useState('')
  const [inputTo,              setInputTo]              = useState('')
  const [selectedCheck,        setSelectedCheck]        = useState(null)
  const [selectedOutage,       setSelectedOutage]       = useState(null) // outage object with optional .diagnostics
  // traceActive removed — top progress bar disabled
  const [ddnsData,             setDdnsData]             = useState(null)  // { status, history }
  const [ddnsChecking,         setDdnsChecking]         = useState(false)
  const [ddnsPortScanning,     setDdnsPortScanning]     = useState(false)

  function clearOutage() { setSelectedOutage(null) }
  const { toasts, add: addToast } = useToast()
  const tableRef = useRef(null)

  const loadData = useCallback(async () => {
    const to   = drillDay?.to   ?? customRange?.to   ?? Date.now()
    const from = drillDay?.from ?? customRange?.from ?? (to - rangeMs(range))
    setLoading(true)
    try {
      const res = await api.reports.get({
        from, to,
        ...(eventFilter  && { event:  eventFilter }),
        ...(macFilter.length > 0 && { mac: macFilter.join(',') }),
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
  }, [range, customRange, drillDay, eventFilter, macFilter, subnetFilter, page])

  const loadCharts = useCallback(async () => {
    const to   = customRange?.to   ?? Date.now()
    const from = customRange?.from ?? (to - rangeMs(range))
    try {
      setChartData(await api.reports.chart({ from, to }))
    } catch (e) {
      console.error('[Reports/chart]', e)
    }
  }, [range, customRange])

  // Export outage log as CSV
  const exportOutageCSV = useCallback(() => {
    if (!outageLog || !outageLog.length) return
    const cols = ['outage_ts','captured_at','outage_type','gateway']
    const rows = outageLog.map(o => cols.map(c => JSON.stringify(o[c] ?? '')).join(','))
    const csv = [cols.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `outage_log_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [outageLog])

  // Export outage log to PDF (simple table) using jspdf if available
  const exportOutagePDF = useCallback(() => {
    if (!outageLog || !outageLog.length) return
    try {
      // global jspdf import available in bundle as window.jspdf
      const { jsPDF } = window.jspdf || {}
      if (!jsPDF) return alert('PDF export unavailable')
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      const cols = ['Outage start','Captured at','Type','Gateway']
      const body = outageLog.map(o => [new Date(o.outage_ts||o.captured_at||0).toLocaleString(), new Date(o.captured_at||0).toLocaleString(), o.outage_type||'', o.gateway||''])
      // simple table render
      let y = 40
      doc.setFontSize(12)
      doc.text('Outage Log', 40, 30)
      doc.setFontSize(10)
      const colWidths = [140, 140, 80, 200]
      // header
      let x = 40
      cols.forEach((h, i) => { doc.text(String(h), x, y); x += colWidths[i] })
      y += 18
      for (const r of body) {
        x = 40
        for (let i=0;i<r.length;i++) { doc.text(String(r[i]||''), x, y); x += colWidths[i] }
        y += 14
        if (y > 750) { doc.addPage(); y = 40 }
      }
      doc.save(`outage_log_${new Date().toISOString().slice(0,10)}.pdf`)
    } catch (e) { console.error('PDF export failed', e); alert('PDF export failed') }
  }, [outageLog])

  const loadInternet = useCallback(async () => {
    const to   = customRange?.to   ?? Date.now()
    const from = customRange?.from ?? (to - rangeMs(range))
    try {
      setInternetData(await api.reports.internet({ from, to, limit: 100 }))
    } catch (e) {
      console.error('[Reports/internet]', e)
    }
  }, [range, customRange])

  const loadSpeedtest = useCallback(async () => {
    const to   = customRange?.to   ?? Date.now()
    const from = customRange?.from ?? (to - rangeMs(range))
    try {
      const sd = await api.reports.speedtest({ from, to, limit: 200 })
      setSpeedtestData(sd)
      // set latest single-row for UI gauges
      if (sd && sd.results && sd.results.length) setSpeedLatest(sd.results[0])
    } catch (e) {
      console.error('[Reports/speedtest]', e)
    }
  }, [range, customRange])

  const loadOutages = useCallback(async () => {
    const to   = customRange?.to   ?? Date.now()
    const from = customRange?.from ?? (to - rangeMs(range))
    try {
      // Debug: log the query range sent to the server to help diagnose empty UI lists
      console.debug('[Reports] loadOutages() requesting range', { from, to })
      const od = await api.reports.outages({ from, to })
      console.debug('[Reports] outages response', { count: (od?.outages?.length ?? 0), totalOutages: od?.totalOutages })
      setOutageData(od)
    } catch (e) {
      console.error('[Reports/outages]', e)
    }
  }, [range, customRange])

  async function uploadEvidence(outageTs, file) {
    try {
      const reader = new FileReader()
      const p = new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
      })
      reader.readAsDataURL(file)
      const dataUrl = await p
      const base64 = dataUrl.split(',')[1]
      await fetch(`/api/reports/outages/${outageTs}/evidence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data: base64 })
      })
      await loadOutages()
      addToast('Evidence uploaded')
    } catch (e) { console.error('[uploadEvidence]', e); addToast('Upload failed', 'error') }
  }

  

  const loadOutageLog = useCallback(async (page = 1, limit = outageLogPer) => {
    setOutageLogLoading(true)
    try {
      const res = await fetch(`/api/paginate?table=outage_diagnostics&page=${page}&limit=${limit}&order=${outageLogOrderColumn || 'captured_at'}&dir=${outageLogOrderDir || 'desc'}`).then(r=>r.json()).catch(e => ({ error: e.message }))
      let rows = (res && res.rows) ? res.rows : []
      let total = (res && res.total) ? res.total : 0

      // Fallback: if there are no diagnostic rows (or auth failed), use computed outages
      if ((!rows || rows.length === 0) && outageData?.outages?.length > 0) {
        rows = outageData.outages.map(o => ({
          outage_ts: o.start,
          captured_at: o.captured_at || o.end || o.start,
          outage_type: o.outage_type || o.type || 'unknown',
          gateway: o.diagnostics?.gateway ?? null,
          durationMs: o.durationMs,
          uptimeBeforeMs: o.uptimeBeforeMs,
          diagnostics: o.diagnostics || null
        }))
        total = rows.length
      }

      // Ensure durationMs and uptimeBeforeMs present for display
      rows = rows.map(r => {
        const rr = { ...r }
        if (rr.durationMs == null && rr.outage_ts && rr.captured_at) rr.durationMs = Number(rr.captured_at) - Number(rr.outage_ts)
        if (rr.uptimeBeforeMs == null && rr.outage_ts && rr.prev_up_ts) rr.uptimeBeforeMs = Number(rr.outage_ts) - Number(rr.prev_up_ts)
        return rr
      })
      setOutageLog(rows)
      setOutageLogTotal(total)
      setOutageLogPage(res.page || page)
    } catch (e) {
      console.error('[Reports/outageLog]', e)
    } finally {
      setOutageLogLoading(false)
    }
  }, [outageData, outageLogOrderColumn, outageLogOrderDir, outageLogPer])

  // Ensure outage log loads on first render (default newest-first)
  useEffect(() => { loadOutageLog(1, outageLogPer) }, [loadOutageLog, outageLogPer])

  const loadDdns = useCallback(async () => {
    try {
      const [status, history] = await Promise.all([api.ddns.status(), api.ddns.history()])
      setDdnsData({ status, history })
    } catch (e) {
      console.error('[Reports/ddns]', e)
    }
  }, [])

  const handleForceDdnsCheck = useCallback(async () => {
    setDdnsChecking(true)
    try {
      await api.ddns.update()
      await loadDdns()
    } catch (e) {
      console.error('[Reports/ddns/force]', e)
    } finally {
      setDdnsChecking(false)
    }
  }, [loadDdns])

  const handlePortScan = useCallback(async () => {
    setDdnsPortScanning(true)
    try {
      const scan = await api.ddns.portscan()
      // Merge scan result into existing ddnsData without a full reload
      setDdnsData(prev => prev ? { ...prev, status: { ...prev.status, port_scan: scan } } : prev)
    } catch (e) {
      console.error('[Reports/ddns/portscan]', e)
    } finally {
      setDdnsPortScanning(false)
    }
  }, [])

  // Hide DDNS tab if provider has never been configured
  // Hide VPN tab if no vpn_interface is configured AND no VPN records exist in the loaded data
  const hasVpnConfig = !!networkConfig?.vpn_interface
  const hasVpnData   = internetData?.checks?.some(c => c.vpn_up) ?? false
  const TABS = ALL_TABS.filter(t => {
    if (t.id === 'ddns') return (ddnsData?.status?.provider ?? null) !== null
    if (t.id === 'vpn')  return hasVpnConfig || hasVpnData
    return true
  })
  // If the active tab was hidden (e.g. VPN tab with no config), fall back to overview
  useEffect(() => {
    if (!TABS.some(t => t.id === tab)) setTab('overview')
  }, [TABS, tab])

  useEffect(() => { loadData()    }, [loadData])
  useEffect(() => { loadCharts()  }, [loadCharts])
  useEffect(() => { loadInternet() }, [loadInternet])
  useEffect(() => { loadSpeedtest() }, [loadSpeedtest])

  // Listen for live speedtest SSE events to update mini gauges in real-time
  // Only apply live SSE updates while a manual run is active to avoid UI noise from scheduled runs.
  useEffect(() => {
    const onSpeed = (ev) => {
      try {
        if (!manualActive) return
        const d = ev.detail
        if (!d) return
        // server may emit partial progress (download/upload progress) or final result
        // update latest row + progress hints
        setSpeedLatest(prev => ({ ...(prev||{}), ...d, download_progress: (d.download_progress ?? d.download_pct ?? prev?.download_progress), upload_progress: (d.upload_progress ?? d.upload_pct ?? prev?.upload_progress) }))
      } catch (err) { void err }
    }
    window.addEventListener('claudette:speedtest', onSpeed)
    return () => window.removeEventListener('claudette:speedtest', onSpeed)
  }, [manualActive])
  // Refresh speedtest results when user revisits the page/tab
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void loadSpeedtest()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [loadSpeedtest])
  useEffect(() => { loadOutages()  }, [loadOutages])
  useEffect(() => { loadDdns()     }, [loadDdns])

  useEffect(() => {
    api.reports.devices().then(r => setDevices(r.devices ?? [])).catch(() => {})
    api.config.get().then(cfg => {
      const raw = cfg?.network?.subnets ?? (cfg?.network?.subnet ? [cfg.network.subnet] : [])
      setSubnets(raw)
      setIspConfig(cfg?.isp ?? {})
      setInfraConfig(cfg?.infra ?? {})
      setNetworkConfig({ connectivity_hosts: cfg?.network?.connectivity_hosts ?? [], vpn_interface: cfg?.network?.vpn_interface ?? null })
      setSpeedtestProvider(cfg?.schedule?.speedtest_provider ?? 'cloudflare')
      if (cfg?.network?.vpn_interface) {
        api.services.vpnMeta().then(m => { if (m) setVpnMeta(m) }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  function changeRange(r) {
    if (r === 'custom') {
      const now = new Date().toISOString().slice(0, 16)
      setInputFrom(now)
      setInputTo(now)
      setCustomPickerOpen(true)
      setRange('custom')
      return
    }
    setRange(r)
    setCustomRange(null)
    setCustomPickerOpen(false)
    setDrillDay(null)
    setPage(0)
  }
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
  const rangeLabel = drillDay
    ? drillDay.label
    : range === 'custom' && customRange
      ? `${new Date(customRange.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(customRange.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : RANGE_LABELS[range]

  // VPN exit metadata: prefer the persisted state (updated on every connectivity check),
  // fall back to the most recent VPN speedtest row in the current range.
  const vpnExitIsp = vpnMeta ?? speedtestData?.results?.find(r => r.via === 'vpn') ?? null

  async function handleExportCsv() {
    try {
      setExporting('csv')
      const to   = drillDay?.to   ?? customRange?.to   ?? Date.now()
      const from = drillDay?.from ?? customRange?.from ?? (to - rangeMs(range))
      const [inetData, speedData, evData, outData] = await Promise.all([
        api.reports.internet({ from, to, limit: 10000 }),
        api.reports.speedtest({ from, to, limit: 10000 }),
        api.reports.get({ from, to, ...(eventFilter && { event: eventFilter }), ...(macFilter.length > 0 && { mac: macFilter.join(',') }), limit: 10000, offset: 0 }),
        api.reports.outages({ from, to }),
      ])
      const pDown = ispConfig?.plan_download_mbps ?? 0
      const pUp   = ispConfig?.plan_upload_mbps   ?? 0
      const isp   = ispConfig?.name ?? ''
      const acct  = ispConfig?.account_number ?? ''

      // Shared empty template keeps columns aligned across all sections
      const empty = {
        section: '', timestamp_local: '', timestamp_utc: '', event: '',
        // outage fields
        duration_sec: '', outage_type: '', uptime_before_sec: '', gateway: '',
        // internet check fields
        latency_ms: '', hosts_checked: '', hosts_up: '', hosts_down: '', vpn_up: '', vpn_latency_ms: '',
        // speedtest fields
        via: '', download_mbps: '', upload_mbps: '', ping_ms: '',
        plan_down_mbps: '', plan_up_mbps: '', down_pct_of_plan: '', up_pct_of_plan: '',
        server_name: '', server_host: '', server_location: '', client_ip: '', client_isp: '', client_city: '',
        // traceroute hop fields (for outage_diag_hop rows)
        hop_num: '', hop_ip: '', hop_loss_pct: '', hop_avg_ms: '', hop_best_ms: '', hop_worst_ms: '', hop_probes: '',
        // last-reached hop summary (for internet_outage rows)
        last_reached_hop: '', last_reached_ip: '', last_reached_avg_ms: '',
        // context
        isp: '', account: '', notes: '',
      }
      const row = (overrides) => ({ ...empty, isp, account: acct, ...overrides })

      const rows = []

      // ── Outage incidents ──────────────────────────────────────────────────
      for (const o of outData.outages ?? []) {
        const oHops = o.diagnostics?.traceroute ? parseMtrHops(o.diagnostics.traceroute) : null
        const oLast = oHops ? [...oHops].reverse().find(h => h.loss < 100 && h.host !== '???') : null
        rows.push(row({
          section: 'internet_outage',
          timestamp_local: fmtLocalTs(o.start),
          timestamp_utc:   new Date(o.start).toISOString(),
          event: o.ongoing ? 'internet.outage.ongoing' : 'internet.outage',
          duration_sec:        o.durationMs != null ? Math.round(o.durationMs / 1000) : '',
          outage_type:         o.outage_type ?? '',
          uptime_before_sec:   o.uptimeBeforeMs != null ? Math.round(o.uptimeBeforeMs / 1000) : '',
          gateway:             o.diagnostics?.gateway ?? '',
          last_reached_hop:    oLast ? oLast.hop  : (oHops ? 0 : ''),
          last_reached_ip:     oLast ? oLast.host : (oHops ? 'none' : ''),
          last_reached_avg_ms: oLast ? oLast.avg.toFixed(1) : '',
          notes: o.ongoing ? 'ONGOING' : `ended ${o.end ? fmtLocalTs(o.end) : ''}`,
        }))
        // Per-hop traceroute rows from stored diagnostics
        const tr = o.diagnostics?.traceroute
        if (tr) {
          const hops = parseMtrHops(tr)
          if (hops) {
            for (const h of hops) {
              rows.push(row({
                section:        'outage_diag_hop',
                timestamp_local: fmtLocalTs(o.start),
                timestamp_utc:   new Date(o.start).toISOString(),
                event:          `outage_ts:${o.start}`,
                hop_num:        h.hop,
                hop_ip:         h.host,
                hop_loss_pct:   h.loss,
                hop_avg_ms:     h.avg,
                hop_best_ms:    h.best,
                hop_worst_ms:   h.wrst,
                hop_probes:     h.snt,
              }))
            }
          } else {
            // Store raw traceroute as a single notes row
            rows.push(row({
              section:        'outage_diag_trace',
              timestamp_local: fmtLocalTs(o.start),
              timestamp_utc:   new Date(o.start).toISOString(),
              event:          `outage_ts:${o.start}`,
              notes:          tr.replace(/\n/g, ' | ').substring(0, 500),
            }))
          }
        }
        // Per-host ping detail rows
        for (const h of o.diagnostics?.ping_detail ?? []) {
          rows.push(row({
            section:        'outage_diag_ping',
            timestamp_local: fmtLocalTs(o.start),
            timestamp_utc:   new Date(o.start).toISOString(),
            event:          `outage_ts:${o.start}`,
            hop_ip:         h.host ?? h.ip ?? '',
            latency_ms:     h.ms ?? '',
            notes:          h.ok ? 'up' : 'down',
          }))
        }
      }

      // ── Internet connectivity checks ──────────────────────────────────────
      for (const c of inetData.checks ?? []) {
        rows.push(row({
          section:         'internet_check',
          timestamp_local: fmtLocalTs(c.ts),
          timestamp_utc:   new Date(c.ts).toISOString(),
          event:           c.ok ? 'online' : 'offline',
          latency_ms:      c.avgMs ?? '',
          hosts_checked:   c.hostCount ?? '',
          hosts_up:        c.okCount ?? '',
          hosts_down:      (c.hostCount ?? 0) - (c.okCount ?? 0) || '',
          vpn_up:          c.vpn_up ? 'yes' : 'no',
          vpn_latency_ms:  c.vpnAvgMs ?? '',
          gateway:         c.gateway ?? '',
          outage_type:     c.outage_type ?? '',
        }))
      }

      // ── Speed tests ───────────────────────────────────────────────────────
      for (const r of speedData.results ?? []) {
        const dPct = pDown > 0 && r.download_mbps != null ? Math.round(r.download_mbps / pDown * 100) : ''
        const uPct = pUp   > 0 && r.upload_mbps   != null ? Math.round(r.upload_mbps   / pUp   * 100) : ''
        rows.push(row({
          section:          'speedtest',
          timestamp_local:  fmtLocalTs(r.ts),
          timestamp_utc:    new Date(r.ts).toISOString(),
          event:            'speedtest',
          via:              r.via ?? 'direct',
          download_mbps:    r.download_mbps ?? '',
          upload_mbps:      r.upload_mbps   ?? '',
          ping_ms:          r.ping_ms       ?? '',
          plan_down_mbps:   pDown || '',
          plan_up_mbps:     pUp   || '',
          down_pct_of_plan: dPct,
          up_pct_of_plan:   uPct,
          server_name:      r.server_name     ?? '',
          server_host:      r.server_host     ?? '',
          server_location:  r.server_location ?? '',
          provider:         r.provider        ?? 'cloudflare',
          client_ip:        r.client_ip       ?? '',
          client_isp:       r.client_isp      ?? '',
          client_city:      r.client_city     ?? '',
          notes:            r.error ? `error: ${r.error}` : (dPct && dPct < 50 ? `only ${dPct}% of contracted speed` : ''),
        }))
      }

      // ── All other events ──────────────────────────────────────────────────
      for (const e of evData.events ?? []) {
        rows.push(row({
          section:         e.source ?? 'event',
          timestamp_local: fmtLocalTs(e.ts),
          timestamp_utc:   new Date(e.ts).toISOString(),
          event:           e.event,
          notes:           e.payload ? JSON.stringify(e.payload).substring(0, 300) : '',
          hop_ip:          e.hostname || e.ip || e.mac || '',
        }))
      }

      rows.sort((a, b) => (b.timestamp_utc || '').localeCompare(a.timestamp_utc || ''))
      exportToCsv(rows, `claudette-report-${dateStamp()}.csv`)
    } catch (err) {
      console.error('CSV export failed:', err)
    } finally {
      setExporting(null)
    }
  }

  async function handleExportPdf() {
    try {
      setExporting('pdf')
      const to   = drillDay?.to   ?? customRange?.to   ?? Date.now()
      const from = drillDay?.from ?? customRange?.from ?? (to - rangeMs(range))
      const [speedData, evData] = await Promise.all([
        api.reports.speedtest({ from, to, limit: 200 }),
        api.reports.get({ from, to, limit: 200, offset: 0 }),
      ])
      await exportToPdf({
        rangeLabel,
        summary:       data?.summary,
        internetStats: chartData?.internetStats,
        internet:      chartData?.internet ?? [],
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
      setManualActive(true)
      setRunning(true)
      const before = (speedLatest?.ts) || 0
      await api.reports.runSpeedtest()
      // Poll every 3s until a new speedtest row appears, or fallback after 90s
      const start = Date.now()
      const poll = setInterval(async () => {
        try {
          const res = await api.reports.speedtest({ limit: 1 })
          const newest = (res.results && res.results[0]) || null
            if (newest && newest.ts && newest.ts > before) {
              clearInterval(poll)
              loadSpeedtest()
              setRunning(false)
              setManualActive(false)
          } else if (Date.now() - start > 90000) {
            clearInterval(poll)
            loadSpeedtest()
              setRunning(false)
              setManualActive(false)
          }
        } catch (err) { void err }
      }, 3000)
    } catch (err) {
      console.error('Speed test failed:', err)
      setRunning(false)
    }
  }

  async function handleRunVpnSpeedtest() {
    try {
      setManualActive(true)
      setRunningVpn(true)
      await api.reports.runVpnSpeedtest()
      // Listen for SSE completion — clear spinner immediately when the result arrives
      const onDone = (e) => {
        if (e.detail?.via === 'vpn') {
          window.removeEventListener('claudette:speedtest', onDone)
          clearTimeout(fallbackTimer)
          loadSpeedtest()
          setRunningVpn(false)
          setManualActive(false)
        }
      }
      window.addEventListener('claudette:speedtest', onDone)
      // Fallback: Ookla can take up to 90s; clear spinner even if SSE is missed
      const fallbackTimer = setTimeout(() => {
        window.removeEventListener('claudette:speedtest', onDone)
        loadSpeedtest()
        setRunningVpn(false)
        setManualActive(false)
      }, 90000)
    } catch (e) {
      console.error('VPN speed test failed:', e)
      addToast(e.message || 'VPN speed test failed', 'error')
      setRunningVpn(false)
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
      if ((stats.ispFailures ?? 0) > 0)   lines.push(`ISP failures:       ${stats.ispFailures} (internet unreachable, gateway was OK — ISP-side issue)`)
      if ((stats.infraFailures ?? 0) > 0) lines.push(`Infra failures:     ${stats.infraFailures} (local gateway unreachable — router/switch issue)`)
      if (stats.gateway) lines.push(`Gateway detected:   ${stats.gateway}`)
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
    if (ispConfig?.sla_url || ispConfig?.sla_notes) {
      lines.push('SLA EVIDENCE')
      lines.push('------------')
      if (ispConfig.sla_url)   lines.push(`SLA document: ${ispConfig.sla_url}`)
      if (ispConfig.sla_notes) lines.push(`Notes: ${ispConfig.sla_notes}`)
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
        });
      (async () => {
      try {
        await write
        setCopiedIsp(true)
        addToast('ISP report copied to clipboard')
        // keep the tick visible slightly longer so it's noticeable
        setTimeout(() => setCopiedIsp(false), 3000)
      } catch (err) { void err
        // fallback: show error toast
        addToast('Copy to clipboard failed', 'error')
      }
    })()
  }

  return (
    <div id="reports-root" className="flex flex-col h-full overflow-hidden">
      <ToastStack toasts={toasts} />

      {/* Check detail modal */}
      {/* top progress bar intentionally removed for speedtest UI */}

      {selectedCheck && (
        <CheckDetailModal
          check={selectedCheck}
          onClose={() => setSelectedCheck(null)}
        />
      )}

      {/* Outage detail modal */}
      {selectedOutage && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) clearOutage() }}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#0d0d1f] border border-red-500/30 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-red-500/20 flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-semibold text-red-300">Outage Detail</span>
                  {selectedOutage.outage_type === 'isp'
                    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/10 border border-orange-500/30 text-orange-400">ISP</span>
                    : selectedOutage.outage_type === 'infra'
                    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">Infra</span>
                    : null}
                  {selectedOutage.ongoing && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 border border-red-500/40 text-red-400 animate-pulse">⚠ ONGOING</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                  <span>Started: <span className="text-red-300">{new Date(selectedOutage.start).toLocaleString('en-GB')}</span></span>
                  {selectedOutage.end && <span>Restored: <span className="text-emerald-400">{new Date(selectedOutage.end).toLocaleString('en-GB')}</span></span>}
                  <span>Duration: <span className="text-red-300 font-bold">{fmtMs(selectedOutage.durationMs)}{selectedOutage.ongoing ? '+' : ''}</span></span>
                  {selectedOutage.uptimeBeforeMs != null && <span>Was up for: <span className="text-slate-400">{fmtMs(selectedOutage.uptimeBeforeMs)}</span></span>}
                </div>
              </div>
              <button onClick={clearOutage} className="p-1.5 hover:bg-white/5 rounded-lg transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            {/* Body */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Outage summary — always shown */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-xl px-4 py-3 border border-red-500/20 bg-[#0a0a18]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Started</p>
                  <p className="text-sm font-semibold text-red-300 tabular-nums">{new Date(selectedOutage.start).toLocaleString('en-GB')}</p>
                </div>
                <div className="rounded-xl px-4 py-3 border border-[#1a1a30] bg-[#0a0a18]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Restored</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {selectedOutage.ongoing
                      ? <span className="text-red-400 animate-pulse">Still offline</span>
                      : <span className="text-emerald-400">{new Date(selectedOutage.end).toLocaleString('en-GB')}</span>}
                  </p>
                </div>
                <div className="rounded-xl px-4 py-3 border border-red-500/20 bg-[#0a0a18]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Down For</p>
                  <p className="text-xl font-bold text-red-300 tabular-nums">{fmtMs(selectedOutage.durationMs)}{selectedOutage.ongoing ? '+' : ''}</p>
                </div>
                {selectedOutage.uptimeBeforeMs != null && (
                  <div className="rounded-xl px-4 py-3 border border-[#1a1a30] bg-[#0a0a18]">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Was Up For</p>
                    <p className="text-sm font-semibold text-slate-300 tabular-nums">{fmtMs(selectedOutage.uptimeBeforeMs)}</p>
                  </div>
                )}
                {selectedOutage.outage_type && (
                  <div className="rounded-xl px-4 py-3 border border-[#1a1a30] bg-[#0a0a18]">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Cause</p>
                    {selectedOutage.outage_type === 'isp'
                      ? <span className="px-2 py-1 rounded text-xs font-bold bg-orange-500/10 border border-orange-500/30 text-orange-400">ISP fault</span>
                      : <span className="px-2 py-1 rounded text-xs font-bold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">Infrastructure (local)</span>}
                  </div>
                )}
              </div>

              {/* Diagnostics section */}
              {selectedOutage.diagnostics ? (
                <>
                  {/* Ping results at time of outage */}
                  {selectedOutage.diagnostics.ping_detail?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Wifi className="w-3 h-3" /> Connectivity at Outage Start
                        {selectedOutage.diagnostics.gateway && <span className="text-slate-500 normal-case font-normal">· gateway: <span className="font-mono">{selectedOutage.diagnostics.gateway}</span></span>}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedOutage.diagnostics.ping_detail.map((r, i) => (
                          <span key={i} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border font-mono ${
                            r.ok ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-400' : 'bg-red-500/10 border-red-500/25 text-red-400'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                            {r.host}
                            {r.ms != null && <span className="text-[10px] opacity-70">{r.ms}ms</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Traceroute */}
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                      <Activity className="w-3 h-3" /> Packet Path at Outage Start
                      <span className="text-slate-500 normal-case font-normal">captured {new Date(selectedOutage.diagnostics.captured_at).toLocaleString('en-GB')}</span>
                    </p>
                    <OutageMtrView output={selectedOutage.diagnostics.traceroute || ''} outageType={selectedOutage.outage_type} />
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-medium">Attach Evidence</div>
                        <div>
                          <label className="flex items-center gap-2 text-xs">
                            <input type="file" onChange={e => e.target.files[0] && uploadEvidence(selectedOutage.start, e.target.files[0])} />
                          </label>
                        </div>
                      </div>
                      <EvidenceList outage={selectedOutage} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#1a1a30] bg-[#080810] text-[11px] text-slate-500">
                  <Activity className="w-4 h-4 opacity-40 flex-shrink-0" />
                  No diagnostics stored for this outage — traceroute and ping detail are captured automatically when internet goes down
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <BarChart2 className="w-5 h-5 text-indigo-400" />
          <h1 className="text-lg font-bold text-white">Reports</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip tip="Reload all report data">
            <button
              onClick={() => { loadData(); loadCharts(); loadInternet(); loadSpeedtest(); loadOutages() }}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[#1a1a35] text-slate-400 hover:text-slate-200 hover:border-[#2a2a4a] rounded-lg transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </Tooltip>
          <Tooltip tip="Export visible data as a CSV spreadsheet">
            <button onClick={handleExportCsv} disabled={exporting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#1a1a35] text-slate-400 hover:text-slate-200 hover:border-[#2a2a4a] rounded-lg transition-colors disabled:opacity-40">
              <Download className={`w-3.5 h-3.5 ${exporting === 'csv' ? 'animate-spin' : ''}`} />
              {exporting === 'csv' ? 'CSV...' : 'CSV'}
            </button>
          </Tooltip>
          <Tooltip tip="Export a formatted PDF report for ISP disputes">
            <button onClick={handleExportPdf} disabled={exporting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[#1a1a35] text-slate-400 hover:text-slate-200 hover:border-[#2a2a4a] rounded-lg transition-colors disabled:opacity-40">
              <Download className={`w-3.5 h-3.5 ${exporting === 'pdf' ? 'animate-spin' : ''}`} />
              {exporting === 'pdf' ? 'PDF...' : 'PDF'}
            </button>
          </Tooltip>


        </div>
      </div>

      {/* Tab bar + range selector */}
      <div className="flex items-center justify-between px-6 pb-2 flex-shrink-0 border-b border-[#1a1a30]">
        <div className="flex gap-0.5">
          {TABS.map(({ id, label, Icon, tip }) => (
            <Tooltip key={id} tip={tip} side="bottom">
              <button onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-t transition-colors ${
                  tab === id
                    ? 'text-indigo-300 border-b-2 border-indigo-500 pb-[6px]'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="flex gap-0.5 p-0.5 bg-[#0a0a18] rounded-lg border border-[#1a1a30]">
          {RANGE_OPTS.map(r => (
            <Tooltip key={r} tip={RANGE_TIPS[r]} side="bottom">
              <button onClick={() => changeRange(r)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  range === r && !drillDay ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Custom date/time range picker */}
      {customPickerOpen && (
        <div className="flex flex-wrap items-end gap-4 px-6 py-3 border-b border-[#1a1a30] bg-[#06060f]">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">From</label>
            <div className="flex items-center gap-1.5">
              <input
                type="datetime-local"
                value={inputFrom}
                onChange={e => setInputFrom(e.target.value)}
                className="bg-[#0a0a18] border border-[#1a1a30] rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/60 [color-scheme:dark]"
              />
              <button
                title="Set to start of day (00:00:00)"
                onClick={() => setInputFrom(v => v ? v.slice(0, 11) + '00:00' : v)}
                className="px-2 py-1.5 bg-[#0a0a18] border border-[#1a1a30] hover:border-slate-500/40 text-slate-500 hover:text-slate-300 text-[10px] rounded-lg transition-colors whitespace-nowrap"
              >00:00</button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">To</label>
            <div className="flex items-center gap-1.5">
              <input
                type="datetime-local"
                value={inputTo}
                onChange={e => setInputTo(e.target.value)}
                className="bg-[#0a0a18] border border-[#1a1a30] rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/60 [color-scheme:dark]"
              />
              <button
                title="Set to end of day (23:59)"
                onClick={() => setInputTo(v => v ? v.slice(0, 11) + '23:59' : v)}
                className="px-2 py-1.5 bg-[#0a0a18] border border-[#1a1a30] hover:border-slate-500/40 text-slate-500 hover:text-slate-300 text-[10px] rounded-lg transition-colors whitespace-nowrap"
              >23:59</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={!inputFrom || !inputTo}
              onClick={() => {
                const from = new Date(inputFrom).getTime()
                const to   = new Date(inputTo).getTime()
                setCustomRange({ from, to })
                setCustomPickerOpen(false)
                setDrillDay(null)
                setPage(0)
              }}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
            >Apply</button>
            <button
              onClick={() => {
                setCustomPickerOpen(false)
                if (!customRange) { setRange('30d'); setCustomRange(null) }
              }}
              className="px-3.5 py-1.5 bg-[#0a0a18] border border-[#1a1a30] hover:border-slate-500/40 text-slate-400 hover:text-slate-300 text-xs font-medium rounded-lg transition-colors"
            >Cancel</button>
          </div>
          {customRange && (
            <span className="text-[10px] text-slate-500 self-center">
              Applied: {new Date(customRange.from).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} → {new Date(customRange.to).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {/* ── Persistent filter bar (shown whenever the current tab has filterable data) ── */}
      {(tab === 'activity' || tab === 'internet' || tab === 'speedtest') && (
        <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 flex-shrink-0 border-b border-[#1a1a30] bg-[#08080f]">
          {/* Activity filters */}
          {tab === 'activity' && (
            <>
              {EV_FILTERS.map(f => {
                const filterTips = {
                  '': 'Show all event types',
                  device: 'Device join/leave, hostname changes',
                  service: 'Service up/down alerts',
                  scan: 'Network and port scan events',
                  threat: 'Blocked or suspicious traffic',
                  internet: 'Internet connectivity checks',
                }
                return (
                  <Tooltip key={f.value} tip={filterTips[f.value]} side="bottom">
                    <button onClick={() => changeEvFilter(f.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        eventFilter === f.value
                          ? 'bg-indigo-600/25 border-indigo-500/50 text-indigo-300'
                          : 'border-[#1a1a30] text-slate-400 hover:text-slate-200'
                      }`}
                    >{f.label}</button>
                  </Tooltip>
                )
              })}
              {devices.length > 0 && (
                <MultiSelectDropdown
                  label="Devices"
                  options={devices.map(d => ({ value: d.mac, label: d.hostname || d.ip || d.mac }))}
                  selected={macFilter}
                  onApply={macs => { setMacFilter(macs); setPage(0) }}
                />
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
              {[['', 'All', 'Show all connectivity checks'], ['online', 'Online', 'Only checks where internet was up'], ['offline', 'Offline', 'Only outage / offline checks']].map(([v, label, tip]) => (
                <Tooltip key={v} tip={tip} side="bottom">
                  <button onClick={() => setInternetStatusFilter(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      internetStatusFilter === v
                        ? v === 'offline' ? 'bg-red-600/25 border-red-500/50 text-red-300'
                        : v === 'online'  ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-300'
                        : 'bg-indigo-600/25 border-indigo-500/50 text-indigo-300'
                        : 'border-[#1a1a30] text-slate-400 hover:text-slate-200'
                    }`}
                  >{label}</button>
                </Tooltip>
              ))}
            </>
          )}

          {/* Speed test filters */}
          {tab === 'speedtest' && (
            <>
              {(ispConfig?.plan_download_mbps > 0 || ispConfig?.plan_upload_mbps > 0) && (
                <button onClick={() => setSpeedtestBelowSla(v => !v)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    speedtestBelowSla
                      ? 'bg-red-600/25 border-red-500/50 text-red-300'
                      : 'border-[#1a1a30] text-slate-400 hover:text-slate-200'
                  }`}>
                  Below SLA only
                </button>
              )}
            </>
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
            {/* ── Internet health summary ── */}
            {chartData?.internetStats && (() => {
              const stats     = chartData.internetStats
              const uptime    = Number(stats.uptime)
              const outages   = outageData?.totalOutages   ?? 0
              const downMs    = outageData?.totalDowntimeMs ?? 0
              const longestMs = outageData?.longestMs       ?? 0
              const avgLat    = stats.avgLatency
              const ispName   = ispConfig?.name ?? null
              // Latest direct speed test
              const latestDirect = speedtestData?.results?.find(r => (r.via ?? 'direct') === 'direct')
              const planDown     = ispConfig?.plan_download_mbps ?? 0
              const planUp       = ispConfig?.plan_upload_mbps   ?? 0
              // Ongoing outage
              const ongoing = outageData?.outages?.find(o => o.ongoing)
              return (
                <div className={`rounded-xl border p-4 ${ongoing ? 'bg-red-950/25 border-red-500/40' : outages > 0 ? 'bg-[#0a0a18] border-amber-500/20' : 'bg-[#0a0a18] border-emerald-500/15'}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2">
                        <Wifi className={`w-3 h-3 ${ongoing ? 'text-red-400' : outages > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
                        Internet Health
                        <span className="normal-case tracking-normal font-normal text-slate-500">{rangeLabel}</span>
                        {ispName && <span className="normal-case tracking-normal font-normal text-slate-500">· {ispName}</span>}
                      </p>
                      {ongoing && (
                        <p className="text-xs text-red-300 font-semibold mb-2 flex items-center gap-1.5">
                          <AlertTriangle className="w-3 h-3" />
                          Currently offline — down for {fmtMs(ongoing.durationMs)}+
                          <button onClick={() => setTab('internet')} className="text-[10px] text-red-400/70 hover:text-red-300 underline ml-1">view details</button>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {/* Uptime */}
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Uptime</p>
                          <p className={`text-2xl font-bold tabular-nums ${uptime === 100 ? 'text-emerald-400' : uptime >= 99 ? 'text-amber-400' : 'text-red-400'}`}>
                            {uptime === 100 ? '100%' : `${uptime.toFixed(3)}%`}
                          </p>
                        </div>
                        {/* Outages */}
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Outages</p>
                          <p className={`text-2xl font-bold tabular-nums ${outages === 0 ? 'text-emerald-400' : 'text-red-400'}`}>{outages}</p>
                        </div>
                        {/* Total downtime */}
                        {downMs > 0 && (
                          <div>
                            <p className="text-[10px] text-slate-500 mb-0.5">Total downtime</p>
                            <p className="text-2xl font-bold tabular-nums text-red-400">{fmtMs(downMs)}</p>
                          </div>
                        )}
                        {/* Longest outage */}
                        {longestMs > 0 && (
                          <div>
                            <p className="text-[10px] text-slate-500 mb-0.5">Longest outage</p>
                            <p className="text-xl font-bold tabular-nums text-red-300">{fmtMs(longestMs)}</p>
                          </div>
                        )}
                        {/* Avg latency */}
                        {avgLat != null && (
                          <div>
                            <p className="text-[10px] text-slate-500 mb-0.5">Avg latency</p>
                            <p className={`text-2xl font-bold tabular-nums ${avgLat < 30 ? 'text-emerald-400' : avgLat < 80 ? 'text-amber-400' : 'text-red-400'}`}>{avgLat} ms</p>
                          </div>
                        )}
                        {/* Checks */}
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Checks run</p>
                          <p className="text-2xl font-bold tabular-nums text-slate-400">{stats.totalChecks.toLocaleString()}</p>
                        </div>
                        {/* ISP / infra fault split */}
                        {((stats.ispFailures ?? 0) > 0 || (stats.infraFailures ?? 0) > 0) && (
                          <div>
                            <p className="text-[10px] text-slate-500 mb-0.5">Fault attribution</p>
                            <p className="text-sm font-semibold">
                              {(stats.ispFailures ?? 0) > 0 && <span className="text-orange-400">{stats.ispFailures} ISP</span>}
                              {(stats.ispFailures ?? 0) > 0 && (stats.infraFailures ?? 0) > 0 && <span className="text-slate-500 mx-1">·</span>}
                              {(stats.infraFailures ?? 0) > 0 && <span className="text-yellow-400">{stats.infraFailures} Infra</span>}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Latest speed test */}
                    {latestDirect && (
                      <div className="border-l border-[#1a1a30] pl-4 min-w-[140px]">
                        <p className="text-[10px] text-slate-500 mb-2">Latest speed test</p>
                        <div className="space-y-1">
                          <p className={`text-sm font-bold tabular-nums ${planDown > 0 && latestDirect.download_mbps < planDown * 0.8 ? 'text-red-400' : 'text-emerald-400'}`}>
                            ↓ {latestDirect.download_mbps ?? '—'} Mbps
                            {planDown > 0 && latestDirect.download_mbps != null && <span className="text-[10px] font-normal text-slate-500 ml-1">({Math.round(latestDirect.download_mbps / planDown * 100)}%)</span>}
                          </p>
                          <p className={`text-sm font-bold tabular-nums ${planUp > 0 && latestDirect.upload_mbps < planUp * 0.8 ? 'text-red-400' : 'text-sky-400'}`}>
                            ↑ {latestDirect.upload_mbps ?? '—'} Mbps
                            {planUp > 0 && latestDirect.upload_mbps != null && <span className="text-[10px] font-normal text-slate-500 ml-1">({Math.round(latestDirect.upload_mbps / planUp * 100)}%)</span>}
                          </p>
                          {latestDirect.ping_ms != null && <p className="text-xs text-slate-500">{latestDirect.ping_ms} ms ping</p>}
                          <p className="text-[10px] text-slate-500">{new Date(latestDirect.ts).toLocaleString('en-GB')}</p>
                        </div>
                        <button onClick={() => setTab('speedtest')} className="text-[10px] text-indigo-400/60 hover:text-indigo-300 mt-2">all tests →</button>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setTab('internet')} className="text-[10px] text-indigo-400/60 hover:text-indigo-300 transition-colors">Internet details →</button>
                    {outages > 0 && <button onClick={() => setTab('internet')} className="text-[10px] text-red-400/60 hover:text-red-300 transition-colors">View outage log →</button>}
                  </div>
                </div>
              )
            })()}

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
                  <span className="text-slate-500 font-normal ml-1.5">— click a bar to drill into that day</span>
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData.daily} margin={{ top: 2, right: 4, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                    <ChartTooltip content={<ChartTip />} />
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '6px' }} />
                    <Bar dataKey="new"     name="New"     fill={CHART_PALETTE.new}     radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'new')} />
                    <Bar dataKey="online"  name="Online"  fill={CHART_PALETTE.online}  radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'online')} />
                    <Bar dataKey="offline" name="Offline" fill={CHART_PALETTE.offline} radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'offline')} />
                    <Bar dataKey="ports"   name="Ports"   fill={CHART_PALETTE.ports}   radius={[2,2,0,0]} maxBarSize={18} style={{ cursor: 'pointer' }} onClick={d => handleBarClick(d, 'ports')} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-500 text-sm">
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
                      <YAxis type="category" dataKey="port" width={130} tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }} tickFormatter={portLabel} />
                      <ChartTooltip content={<ChartTip />} />
                      <Bar dataKey="count" name="Finds" fill="#818cf8" radius={[0,2,2,0]} maxBarSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-500 text-sm">
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
                      <ChartTooltip content={<ChartTip />} />
                      <Bar dataKey="count" name="Outages" fill="#f87171" radius={[0,2,2,0]} maxBarSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-500 text-sm">
                  No service outages recorded
                </div>
              )}
            </div>
          </>
        )}

        {/* ── INTERNET ── */}
        {tab === 'internet' && (
          <>
            {/* Connection path info banner */}
            {(ispConfig?.name || vpnExitIsp || chartData?.internetStats?.gateway || networkConfig?.connectivity_hosts?.length > 0) && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  {/* Direct path */}
                  <span className="flex items-center flex-wrap gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0a0a18] border border-sky-500/15 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block flex-shrink-0" />
                    <span className="text-slate-500">Direct</span>
                    {ispConfig?.name && <><span className="text-slate-500">·</span><span className="text-slate-300 font-medium">{ispConfig.name}</span></>}
                    {ispConfig?.connection_type && <span className="text-slate-500">({ispConfig.connection_type})</span>}
                    {(ispConfig?.plan_download_mbps > 0 || ispConfig?.plan_upload_mbps > 0) && (
                      <span className="text-slate-500 border-l border-[#1a1a30] pl-1.5">                        {ispConfig.plan_download_mbps > 0 && ispConfig.plan_upload_mbps > 0
                          ? `plan: ${ispConfig.plan_download_mbps}↓/${ispConfig.plan_upload_mbps}↑ Mbps`
                          : ispConfig.plan_download_mbps > 0
                          ? `plan: ${ispConfig.plan_download_mbps} Mbps ↓`
                          : `plan: ${ispConfig.plan_upload_mbps} Mbps ↑`}
                      </span>
                    )}
                    {chartData?.internetStats?.gateway && (
                      <span className="text-slate-600 border-l border-[#1a1a30] pl-1.5" title="Detected default gateway (local router)">
                        gw: <span className="font-mono text-slate-500">{chartData.internetStats.gateway}</span>
                      </span>
                    )}
                    {(() => {
                      const detectedIsp = speedtestData?.results?.find(r => (r.via ?? 'direct') === 'direct')?.client_isp
                      if (detectedIsp && detectedIsp !== ispConfig?.name) {
                        return <span className="text-slate-600 border-l border-[#1a1a30] pl-1.5">detected: <span className="text-slate-500">{detectedIsp}</span></span>
                      }
                      return null
                    })()}
                  </span>
                </div>
                {/* Pinging hosts */}
                {networkConfig?.connectivity_hosts?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500 uppercase tracking-wide">Pinging</span>
                    {networkConfig.connectivity_hosts.map(h => (
                      <span key={h} className="font-mono text-slate-600 bg-[#0a0a18] border border-[#1a1a30] px-1.5 py-0.5 rounded">{h}</span>
                    ))}
                    <span className="text-slate-500">+ http://connectivity-check.ubuntu.com</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Direct Connection stats ── */}
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> Direct Connection
                {ispConfig?.name && <span className="normal-case tracking-normal font-normal text-slate-500">· {ispConfig.name}{ispConfig.connection_type ? ` (${ispConfig.connection_type})` : ''}</span>}
              </p>
              {chartData?.internetStats ? (() => {
                const stats    = chartData.internetStats
                const uptime   = Number(stats.uptime)
                const periodMs = drillDay ? (drillDay.to - drillDay.from)
                  : customRange ? (customRange.to - customRange.from)
                  : rangeMs(range)
                const uptimeMs = Math.round(periodMs * (uptime / 100))
                const downMs   = outageData?.totalDowntimeMs ?? 0
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                    {[
                      { label: 'Uptime %',        value: `${uptime.toFixed(uptime === 100 ? 1 : 3)}%`,  color: uptime < 99.9 ? 'text-red-400' : uptime < 100 ? 'text-amber-400' : 'text-emerald-400', border: uptime < 100 ? 'border-red-500/40' : 'border-sky-500/15',    Icon: Wifi     },
                      { label: 'Total Online',     value: fmtMs(uptimeMs),                              color: uptime === 100 ? 'text-emerald-400' : 'text-sky-400',                                    border: 'border-sky-500/15',                                           Icon: Wifi     },
                      { label: 'Total Offline',    value: downMs > 0 ? fmtMs(downMs) : '—',             color: downMs > 0 ? 'text-red-400' : 'text-slate-500',                                          border: downMs > 0 ? 'border-red-500/40' : 'border-sky-500/15',        Icon: Activity },
                      { label: 'Avg Latency',      value: `${stats.avgLatency} ms`,                     color: 'text-sky-400',                                                                           border: 'border-sky-500/15',                                           Icon: Zap      },
                      { label: 'Checks Run',       value: stats.totalChecks.toLocaleString(),            color: 'text-indigo-400',                                                                        border: 'border-sky-500/15',                                           Icon: Clock    },
                      { label: 'Status Changes',   value: stats.changes,                                color: 'text-slate-300',                                                                         border: 'border-sky-500/15',                                           Icon: Activity },
                    ].map(({ label, value, color, border, Icon }) => (
                      <div key={label} className={`rounded-xl px-4 py-3 border bg-[#0a0a18] ${border}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className={`w-3 h-3 ${color}`} />
                          <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
                        </div>
                        <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                )
              })() : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                  {['Uptime %', 'Total Online', 'Total Offline', 'Avg Latency', 'Checks Run', 'Status Changes'].map(l => (
                    <div key={l} className="rounded-xl px-4 py-3 border border-[#1a1a30] bg-[#0a0a18] animate-pulse">
                      <div className="h-3 w-20 bg-[#1a1a30] rounded mb-2" />
                      <div className="h-6 w-12 bg-[#1a1a30] rounded" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SLA pass/fail panel + percentile pills */}
            {chartData?.internetStats && (() => {
              const uptime       = Number(chartData.internetStats.uptime)
              const totalChecks  = chartData.internetStats.totalChecks ?? 0
              const ispFails     = chartData.internetStats.ispFailures  ?? 0
              const infraFails   = chartData.internetStats.infraFailures ?? 0
              // ISP-attributable uptime = remove only ISP-caused failures from denominator
              const ispUptime    = totalChecks > 0 ? ((totalChecks - ispFails)   / totalChecks * 100) : 100
              // Infra-attributable uptime = remove only infra-caused failures
              const infraUptime  = totalChecks > 0 ? ((totalChecks - infraFails) / totalChecks * 100) : 100
              const ispTarget    = (ispConfig?.expected_uptime ?? 0) > 0 ? ispConfig.expected_uptime : null
              const infraTarget  = (infraConfig?.sla_pct ?? 0) > 0 ? infraConfig.sla_pct : null
              const TIERS        = [100, 99.999, 99.99, 99.9, 99.5, 99, 95, 90]
              // Nearest standard tier at or below the configured ISP target (for ring highlight)
              const targetTier   = ispTarget !== null
                ? (TIERS.includes(ispTarget) ? ispTarget : (TIERS.find(t => t <= ispTarget) ?? null))
                : null
              const pDown   = ispConfig?.plan_download_mbps ?? 0
              const pUp     = ispConfig?.plan_upload_mbps   ?? 0
              const avgDown = chartData?.speedStats?.avgDown ?? null
              const avgUp   = chartData?.speedStats?.avgUp   ?? null
              const slaDown = pDown > 0 ? pDown : null
              const slaUp   = pUp   > 0 ? pUp   : null
              const uptimePass     = ispTarget   !== null ? uptime     >= ispTarget   : null
              const ispUptimePass  = ispTarget   !== null ? ispUptime  >= ispTarget   : null
              const infraUptimePass = infraTarget !== null ? infraUptime >= infraTarget : null
              return (
                <div className="space-y-2">
                  {/* Percentile tier pills — based on overall uptime */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide mr-1">Overall uptime tiers</span>
                    {TIERS.map(tier => {
                      const pass     = uptime >= tier
                      const isTarget = tier === targetTier
                      return (
                        <span key={tier}
                          title={(isTarget ? '⊙ Your ISP SLA target — ' : '') + (pass ? `✓ Meets ${tier}%` : `✗ Below ${tier}%`)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border cursor-default ${
                            pass
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-red-500/10 border-red-500/30 text-red-400'
                          } ${isTarget ? (pass ? 'ring-1 ring-emerald-400/60' : 'ring-1 ring-red-400/60') : ''}`}>
                          {isTarget ? '⊙' : (pass ? '✓' : '✗')} {tier}%
                        </span>
                      )
                    })}
                    {ispTarget !== null && (
                      <span className="text-[10px] text-slate-500 ml-1">· ISP SLA target: {ispTarget}%</span>
                    )}
                  </div>
                  {/* SLA pass/fail badges */}
                  {(ispTarget !== null || infraTarget !== null || slaDown !== null || slaUp !== null) && (
                    <div className="flex flex-wrap gap-2">
                      {/* Overall uptime vs ISP SLA */}
                      {ispTarget !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          uptimePass ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300' : 'bg-red-500/8 border-red-500/25 text-red-300'
                        }`} title="Overall measured uptime vs ISP contracted SLA">
                          <span>{uptimePass ? '✓' : '✗'}</span>
                          <span className="font-medium">Overall Uptime</span>
                          <span className="opacity-70">{uptime.toFixed(uptime === 100 ? 1 : 3)}% / {ispTarget}% ISP SLA</span>
                        </div>
                      )}
                      {/* ISP-only uptime (excluding infra failures) vs ISP SLA */}
                      {ispTarget !== null && ispFails > 0 && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          ispUptimePass ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300' : 'bg-red-500/8 border-red-500/25 text-red-300'
                        }`} title={`Uptime excluding ISP-caused failures only (${ispFails} ISP-side check${ispFails !== 1 ? 's' : ''} failed)`}>
                          <span>{ispUptimePass ? '✓' : '✗'}</span>
                          <span className="font-medium">ISP-Attributable</span>
                          <span className="opacity-70">{ispUptime.toFixed(3)}%</span>
                          <span className="opacity-40 text-[10px]">({ispFails} ISP fail{ispFails !== 1 ? 's' : ''})</span>
                        </div>
                      )}
                      {/* Infra uptime vs infra SLA target */}
                      {infraTarget !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          infraUptimePass ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300' : 'bg-amber-500/8 border-amber-500/25 text-amber-300'
                        }`} title={`Local infra uptime vs your ${infraTarget}% target (${infraFails} infra check${infraFails !== 1 ? 's' : ''} failed — gateway unreachable)`}>
                          <span>{infraUptimePass ? '✓' : '✗'}</span>
                          <span className="font-medium">Infra Uptime</span>
                          <span className="opacity-70">{infraUptime.toFixed(3)}% / {infraTarget}% target</span>
                          <span className="opacity-40 text-[10px]">({infraFails} infra fail{infraFails !== 1 ? 's' : ''})</span>
                        </div>
                      )}
                      {slaDown !== null && avgDown !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          avgDown >= slaDown ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300' : 'bg-red-500/8 border-red-500/25 text-red-300'
                        }`}>
                          <span>{avgDown >= slaDown ? '✓' : '✗'}</span>
                          <span className="font-medium">Download SLA</span>
                          <span className="opacity-70">{avgDown} / {slaDown} Mbps plan</span>
                        </div>
                      )}
                      {slaUp !== null && avgUp !== null && (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${
                          avgUp >= slaUp ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300' : 'bg-red-500/8 border-red-500/25 text-red-300'
                        }`}>
                          <span>{avgUp >= slaUp ? '✓' : '✗'}</span>
                          <span className="font-medium">Upload SLA</span>
                          <span className="opacity-70">{avgUp} / {slaUp} Mbps plan</span>
                        </div>
                      )}
                    </div>
                  )}
                  {/* SLA source link */}
                  {ispConfig?.sla_url && (
                    <div className="flex items-center gap-1.5">
                      <a href={ispConfig.sla_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-[10px] text-indigo-400/70 hover:text-indigo-300 transition-colors">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        SLA document
                      </a>
                      {ispConfig.sla_notes && <span className="text-[10px] text-slate-500">· {ispConfig.sla_notes.slice(0, 100)}{ispConfig.sla_notes.length > 100 ? '…' : ''}</span>}
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
                    {ispConfig?.name ? <>&nbsp;· ISP: {ispConfig.name} — expected {ispConfig.expected_uptime ?? 100}% uptime</> : <>&nbsp;· Expected uptime: {ispConfig?.expected_uptime ?? 100}%</>}
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
                  <span className={`inline-block transition-opacity duration-300 ${copiedIsp ? 'opacity-100' : 'opacity-0'}`}>{'Copied!'}</span>
                  <span className={`inline-block transition-opacity duration-300 ${copiedIsp ? 'opacity-0 ml-0' : 'opacity-100 ml-0'}`}>{'Copy to Clipboard'}</span>
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
                    <span className={`inline-block transition-opacity duration-300 ${copiedIsp ? 'opacity-100' : 'opacity-0'}`}>{'Copied!'}</span>
                    <span className={`inline-block transition-opacity duration-300 ${copiedIsp ? 'opacity-0 ml-0' : 'opacity-100 ml-0'}`}>{'Copy to Clipboard'}</span>
                  </button>
                </div>
                <div className="overflow-x-auto text-[11px]">
                  <table className="w-full">
                    <thead className="bg-[#08080f]">
                      <tr className="border-b border-[#1a1a30]">
                        <th className="px-4 py-2 text-left text-slate-500 font-medium w-8">#</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium">Started</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium">Restored</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium">Type</th>
                        <th className="px-4 py-2 text-right text-slate-500 font-medium">Down For</th>
                        <th className="px-4 py-2 text-right text-slate-500 font-medium">Was Up For</th>
                        <th className="px-4 py-2 text-right text-slate-500 font-medium">Last hop</th>
                      </tr>
                    </thead>
                      <tbody className="divide-y divide-[#0f0f1c]">
                      {outageLog.map((o, i) => (
                        <tr key={i}
                          onClick={() => setSelectedOutage(o)}
                          className={`cursor-pointer hover:bg-red-950/30 transition-colors ${o.ongoing ? 'bg-red-950/20' : ''}`}>
                          <td className="px-4 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                          <td className="px-4 py-2 text-red-300 tabular-nums whitespace-nowrap">{new Date(o.outage_ts || o.captured_at || o.start).toLocaleString('en-GB')}</td>
                          <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                            {o.ongoing
                              ? <span className="text-red-400 font-semibold">&#9888; Still offline</span>
                              : <span className="text-emerald-400">{new Date(o.captured_at || o.end).toLocaleString('en-GB')}</span>}
                          </td>
                          <td className="px-4 py-2">
                            {o.outage_type === 'isp'
                              ? <span className="px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400">ISP</span>
                              : o.outage_type === 'infra'
                              ? <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400" title="Local gateway unreachable — likely an infrastructure issue, not the ISP">Infra</span>
                              : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-bold tabular-nums text-red-300">
                            {fmtMs(o.durationMs)}{o.ongoing ? '+' : ''}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                            {o.uptimeBeforeMs != null ? fmtMs(o.uptimeBeforeMs) : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {(() => {
                              if (!o.diagnostics) return <span className="text-[10px] text-slate-700">—</span>
                              const hops = parseMtrHops(o.diagnostics.traceroute)
                              const last = hops ? [...hops].reverse().find(h => h.loss < 100 && h.host !== '???') : null
                              return last
                                ? <span className="text-[10px] font-mono text-emerald-500/70" title={`Last reached: ${last.host} (hop ${last.hop}, avg ${last.avg.toFixed(1)}ms)`}>→ {last.host}</span>
                                : <span className="text-[10px] text-red-600/60" title="No hops responded">0 hops</span>
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 flex items-center justify-between">
                    <div className="text-xs text-slate-400">{outageLogTotal} rows</div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-400">Order:</label>
                        <select value={outageLogOrderDir} onChange={e => { setOutageLogOrderDir(e.target.value); loadOutageLog(1) }} className="px-2 py-1 bg-[#071025] border border-[#1a1a30] rounded text-sm">
                          <option value="desc">Newest first</option>
                          <option value="asc">Oldest first</option>
                        </select>
                        <button onClick={exportOutageCSV} className="px-2 py-1 border rounded">Export CSV</button>
                        <button onClick={exportOutagePDF} className="px-2 py-1 border rounded">Export PDF</button>
                        <div className="flex items-center gap-1">
                          <Pagination page={outageLogPage} total={outageLogTotal} per={outageLogPer} onChangePage={(p)=>loadOutageLog(p, outageLogPer)} onChangePer={(n)=>{ setOutageLogPer(n); loadOutageLog(1, n) }} />
                        </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Connectivity chart */}
            {(chartData?.internet?.length ?? 0) > 0 ? (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <p className="text-xs font-medium text-slate-400">Latency Over Time</p>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <span className="inline-block w-4 border-t-2 border-sky-400 rounded" />
                      Direct
                    </span>
                  </div>
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
                    <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                    <Line type="monotone" dataKey="ms" name="Direct Latency" stroke="#38bdf8" dot={false} strokeWidth={1.5} unit="ms" connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-8 flex items-center justify-center text-slate-500 text-sm">
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
                        <th className="px-2 py-1.5 text-left text-sky-400/70">Direct Status</th>
                        <th className="px-2 py-1.5 text-left text-violet-400/70">VPN</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Mode</th>
                <th className="px-2 py-1.5 text-right text-slate-400">Direct{ispConfig?.name ? <span className="text-slate-500 font-normal ml-1">({ispConfig.name})</span> : ''}</th>
                        <th className="px-2 py-1.5 text-right text-slate-400">Hosts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((check, i) => (
                        <tr key={i} className="border-b border-[#1a1a30] hover:bg-[#15151f] cursor-pointer" onClick={() => setSelectedCheck(check)}>
                          <td className="px-2 py-1.5 text-slate-400">{new Date(check.ts).toLocaleString('en-GB')}</td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                              check.ok
                                ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                                : 'bg-red-500/15 text-red-400 border-red-500/20'
                            }`}>{check.ok ? 'Online' : 'Offline'}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            {check.vpn_up
                              ? <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                  check.vpn_ok !== false
                                    ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                                    : 'bg-red-500/15 text-red-400 border-red-500/20'
                                }`}>{check.vpn_ok !== false ? '✓' : '✗'}</span>
                              : <span className="text-slate-700 text-[10px]">—</span>
                            }
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
                        <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-500 text-xs">No checks match the filter</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                )
              })() : (
                <div className="flex items-center justify-center py-8 text-slate-500 text-sm">No check data in this range</div>
              )}
            </div>
          </>
        )}

        {/* ── VPN ── */}
        {tab === 'vpn' && (() => {
          const checks = internetData?.checks ?? []
          const vpnChecks = checks.filter(c => c.vpn_up === true)
          const vpnOkChecks = vpnChecks.filter(c => c.vpn_ok !== false)
          const vpnUptime = vpnChecks.length > 0 ? parseFloat(((vpnOkChecks.length / vpnChecks.length) * 100).toFixed(1)) : null
          const vpnLatMs = vpnChecks.filter(c => c.vpnAvgMs != null)
          const vpnAvgLat = vpnLatMs.length > 0 ? Math.round(vpnLatMs.reduce((s, c) => s + c.vpnAvgMs, 0) / vpnLatMs.length) : null
          const vpnDownChecks = vpnChecks.filter(c => c.vpn_ok === false).length
          if (vpnChecks.length === 0) return (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <Shield className="w-8 h-8 text-violet-500/30" />
              <p className="text-slate-400 font-medium">No VPN data in this period</p>
              <p className="text-slate-500 text-sm">VPN stats appear here when the system detects an active VPN during internet checks.</p>
            </div>
          )
          return (
            <>
              {/* VPN connection info */}
              {(vpnExitIsp?.client_isp || networkConfig?.vpn_interface || networkConfig?.connectivity_hosts?.length > 0) && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-2">
                    {vpnExitIsp?.client_isp && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0a0a18] border border-violet-500/20 text-[11px] text-violet-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block flex-shrink-0" />
                        <span className="text-violet-500">VPN exit</span>
                        <span className="text-violet-700">·</span>
                        <span className="text-violet-300 font-medium">{vpnExitIsp.client_isp}</span>
                        {vpnExitIsp.client_city && <span className="text-violet-600">· {vpnExitIsp.client_city}{vpnExitIsp.client_country ? `, ${vpnExitIsp.client_country}` : ''}</span>}
                        {networkConfig?.vpn_interface && <span className="font-mono text-violet-700 border-l border-violet-900 pl-1.5 text-[10px]">{networkConfig.vpn_interface}</span>}
                      </span>
                    )}
                    {!vpnExitIsp?.client_isp && networkConfig?.vpn_interface && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0a0a18] border border-violet-500/20 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block flex-shrink-0" />
                        <span className="font-mono text-violet-600">{networkConfig.vpn_interface}</span>
                      </span>
                    )}
                  </div>
                  {networkConfig?.connectivity_hosts?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="text-slate-500 uppercase tracking-wide">Pinging via VPN</span>
                      {networkConfig.connectivity_hosts.map(h => (
                        <span key={h} className="font-mono text-slate-500 bg-[#0a0a18] border border-[#1a1a30] px-1.5 py-0.5 rounded">{h}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* VPN Tunnel stats */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" /> VPN Tunnel
                  {vpnExitIsp?.client_isp && <span className="normal-case tracking-normal font-normal text-violet-500/70">· exit via {vpnExitIsp.client_isp}{vpnExitIsp.client_city ? `, ${vpnExitIsp.client_city}` : ''}</span>}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className={`rounded-xl px-4 py-3 border bg-[#0a0a18] ${vpnUptime != null && vpnUptime < 99 ? 'border-red-500/30' : 'border-violet-500/20'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Wifi className="w-3 h-3 text-violet-400" />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wide">VPN Uptime</span>
                    </div>
                    <p className={`text-xl font-bold tabular-nums ${vpnUptime != null && vpnUptime < 99 ? 'text-red-400' : 'text-violet-400'}`}>
                      {vpnUptime != null ? `${vpnUptime}%` : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl px-4 py-3 border border-violet-500/20 bg-[#0a0a18]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap className="w-3 h-3 text-violet-400" />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wide">Avg Latency</span>
                    </div>
                    <p className="text-xl font-bold tabular-nums text-violet-400">{vpnAvgLat != null ? `${vpnAvgLat} ms` : '—'}</p>
                  </div>
                  <div className="rounded-xl px-4 py-3 border border-violet-500/20 bg-[#0a0a18]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Clock className="w-3 h-3 text-violet-400" />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wide">Checks w/ VPN</span>
                    </div>
                    <p className="text-xl font-bold tabular-nums text-violet-400">{vpnChecks.length}</p>
                  </div>
                  <div className={`rounded-xl px-4 py-3 border bg-[#0a0a18] ${vpnDownChecks > 0 ? 'border-red-500/30' : 'border-violet-500/20'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Activity className="w-3 h-3 text-violet-400" />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wide">VPN Drops</span>
                    </div>
                    <p className={`text-xl font-bold tabular-nums ${vpnDownChecks > 0 ? 'text-red-400' : 'text-violet-400'}`}>{vpnDownChecks}</p>
                  </div>
                </div>
              </div>

              {/* VPN Latency chart — always show when internet data exists; empty message when VPN is down */}
              {(chartData?.internet?.length ?? 0) > 0 && (
                <div className="bg-[#0a0a18] border border-violet-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <p className="text-xs font-medium text-slate-400">VPN Latency Over Time</p>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <span className="inline-block w-4 border-t-2 border-violet-400 rounded" />
                      VPN
                    </span>
                  </div>
                  {chartData.internet.some(r => r.vpn_ms != null) ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={chartData.internet} margin={{ top: 2, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                        <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                          tickFormatter={v => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit="ms" />
                        <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                        <Line type="monotone" dataKey="vpn_ms" name="VPN Latency" stroke="#a78bfa" dot={false} strokeWidth={1.5} unit="ms" connectNulls={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[200px] flex flex-col items-center justify-center gap-2">
                      <p className="text-sm text-slate-400">No VPN latency data in this period</p>
                      <p className="text-[11px] text-slate-500">Ensure the VPN interface ({networkConfig?.vpn_interface ?? 'tun0'}) is connected</p>
                    </div>
                  )}
                </div>
              )}

              {/* VPN Checks table */}
              <div className="bg-[#0a0a18] border border-violet-500/20 rounded-xl p-4">
                <p className="text-xs font-medium text-violet-400/80 mb-3">VPN Checks</p>
                <div className="overflow-x-auto max-h-96 overflow-y-auto text-[11px]">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-[#0a0a18]">
                      <tr className="border-b border-[#1a1a30]">
                        <th className="px-2 py-1.5 text-left text-slate-400">Time</th>
                        <th className="px-2 py-1.5 text-left text-violet-500/70">VPN Status</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Mode</th>
                        <th className="px-2 py-1.5 text-right text-violet-500/70">VPN Latency{vpnExitIsp?.client_isp ? <span className="text-violet-700 font-normal ml-1">({vpnExitIsp.client_isp})</span> : ''}</th>
                        <th className="px-2 py-1.5 text-right text-slate-400">Hosts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vpnChecks.map((check, i) => (
                        <tr key={i} className="border-b border-[#1a1a30] hover:bg-[#15151f] cursor-pointer" onClick={() => setSelectedCheck(check)}>
                          <td className="px-2 py-1.5 text-slate-400">{new Date(check.ts).toLocaleString('en-GB')}</td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                              check.vpn_ok !== false
                                ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                                : 'bg-red-500/15 text-red-400 border-red-500/20'
                            }`}>{check.vpn_ok !== false ? 'Up' : 'Down'}</span>
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
                          <td className="px-2 py-1.5 text-right">
                            {check.vpn_ok === false
                              ? <span className="text-red-400 text-[10px] font-bold">down</span>
                              : check.vpnAvgMs != null
                                ? <span className="text-violet-400">{check.vpnAvgMs} ms</span>
                                : <span className="text-slate-600 text-[10px]">no data</span>
                            }
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-400">
                            <span className="text-emerald-400">{check.okCount}</span> / {check.hostCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )
        })()}

        {/* ── SPEED TEST ── */}
        {tab === 'speedtest' && (() => {
          const allRows    = speedtestData?.results ?? []
          const directRows = allRows.filter(r => (r.via ?? 'direct') === 'direct')
          const vpnRows    = allRows.filter(r => r.via === 'vpn')
          const lastDirectTs = directRows[0]?.ts ?? null
          const lastVpnTs    = vpnRows[0]?.ts    ?? null
          return (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Speed Test History</p>
                <p className="text-[11px] text-slate-500 mt-0.5">via {speedtestProvider === 'ookla' ? 'Ookla' : 'Cloudflare'} — Download / Upload / Ping</p>
              </div>
              <div className="flex items-end gap-2">
                {/* Direct button */}
                <div className="flex flex-col items-end gap-0.5">
                  {lastDirectTs && <span className="text-[10px] text-slate-500">last: {fmtDate(lastDirectTs)}</span>}
                  <Tooltip tip="Test direct internet speed (bypasses VPN)" side="bottom">
                    <button onClick={handleRunSpeedtest} disabled={running || runningVpn}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 rounded-lg transition-colors disabled:opacity-40">
                      <Zap className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
                      {running ? 'Running…' : 'Run Direct'}
                    </button>
                  </Tooltip>
                </div>
                {/* VPN button */}
                <div className="flex flex-col items-end gap-0.5">
                  {lastVpnTs && <span className="text-[10px] text-slate-500">last: {fmtDate(lastVpnTs)}</span>}
                  <Tooltip tip="Test speed through your VPN tunnel" side="bottom">
                    <button onClick={handleRunVpnSpeedtest} disabled={running || runningVpn}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600/20 border border-violet-500/40 text-violet-300 hover:bg-violet-600/30 rounded-lg transition-colors disabled:opacity-40">
                      <Shield className={`w-3.5 h-3.5 ${runningVpn ? 'animate-spin' : ''}`} />
                      {runningVpn ? 'Running…' : 'Run VPN'}
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Mini gauges showing latest recorded or live speedtest */}
            <div className="mt-3 mb-4">
              {(manualActive || running || runningVpn) ? (
                <MiniSpeedGauges
                  download={Math.round(speedLatest?.download_mbps ?? (speedtestData?.results?.[0]?.download_mbps ?? 0))}
                  upload={Math.round(speedLatest?.upload_mbps   ?? (speedtestData?.results?.[0]?.upload_mbps   ?? 0))}
                  ping={Math.round(speedLatest?.ping_ms ?? (speedtestData?.results?.[0]?.ping_ms ?? 0))}
                />
              ) : (
                <div className="text-[11px] text-slate-400 mt-2">Gauges are shown only during manual tests.</div>
              )}
              <div className="text-[11px] text-slate-400 mt-2">
                {speedLatest ? (
                  <div>Last test: {fmtDate(speedLatest.ts)} — Server: {speedLatest.server_name || speedLatest.server_host || 'unknown'}</div>
                ) : (
                  <div>No recent tests recorded</div>
                )}
              </div>
            </div>

            {running && (
              <div className="flex items-center gap-2 text-xs text-indigo-400 bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Direct speed test in progress — measuring ISP via {speedtestProvider === 'ookla' ? 'Ookla' : 'Cloudflare'} (~30–60s)…
              </div>
            )}
            {runningVpn && (
              <div className="flex items-center gap-2 text-xs text-violet-400 bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                VPN speed test in progress — measuring {networkConfig?.vpn_interface ?? 'VPN'} via {speedtestProvider === 'ookla' ? 'Ookla' : 'Cloudflare'} (~30–60s)…
              </div>
            )}

            {speedtestData?.results?.length > 0 ? (() => {
              const rows       = speedtestData.results
              const directRows = rows.filter(r => (r.via ?? 'direct') === 'direct')
              const vpnRows    = rows.filter(r => r.via === 'vpn')
              const planDown   = ispConfig?.plan_download_mbps ?? 0
              const planUp     = ispConfig?.plan_upload_mbps   ?? 0
              const sla        = 0.80
              const downColor  = (v) => !planDown ? 'text-emerald-400' : v < planDown * 0.8 ? 'text-red-400' : v < planDown * 0.95 ? 'text-amber-400' : 'text-emerald-400'
              const upColor    = (v) => !planUp   ? 'text-sky-400'     : v < planUp   * 0.8 ? 'text-red-400' : v < planUp   * 0.95 ? 'text-amber-400' : 'text-sky-400'
              const latestDirect = directRows[0]
              const latestVpn    = vpnRows[0]
              const avgDown  = directRows.length ? (directRows.reduce((s, r) => s + (r.download_mbps ?? 0), 0) / directRows.length).toFixed(1) : null
              const avgUp    = directRows.length ? (directRows.reduce((s, r) => s + (r.upload_mbps   ?? 0), 0) / directRows.length).toFixed(1) : null
              const avgDownV = vpnRows.length    ? (vpnRows.reduce((s, r) => s + (r.download_mbps ?? 0), 0) / vpnRows.length).toFixed(1)    : null
              const avgUpV   = vpnRows.length    ? (vpnRows.reduce((s, r) => s + (r.upload_mbps   ?? 0), 0) / vpnRows.length).toFixed(1)    : null
              const belowDown = planDown > 0 ? directRows.filter(r => (r.download_mbps ?? 0) < planDown * sla).length : 0
              const belowUp   = planUp   > 0 ? directRows.filter(r => (r.upload_mbps   ?? 0) < planUp   * sla).length : 0
              const avgDownPct = planDown > 0 && avgDown  ? Math.round((parseFloat(avgDown)  / planDown) * 100) : null
              const avgUpPct   = planUp   > 0 && avgUp    ? Math.round((parseFloat(avgUp)    / planUp)   * 100) : null

              // Separate chart data for each series so each chart's X-axis only spans its own tests.
              // Reverse so charts render oldest → newest (left to right).
              const directChartRows = [...directRows].reverse().map(r => ({
                ts: r.ts,
                direct_down: r.download_mbps ?? null,
                direct_up:   r.upload_mbps   ?? null,
              }))
              const vpnChartRows = [...vpnRows].reverse().map(r => ({
                ts: r.ts,
                vpn_down: r.download_mbps ?? null,
                vpn_up:   r.upload_mbps   ?? null,
              }))

              const StatCard = ({ label, value, color, border }) => (
                <div className={`rounded-xl px-4 py-3 border bg-[#0a0a18] ${border}`}>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                  <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                </div>
              )

              return (
                <>
                  {/* Direct stat cards */}
                  {latestDirect && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Direct ({directRows.length} test{directRows.length !== 1 ? 's' : ''})
                        {ispConfig?.name && <span className="text-slate-600 normal-case tracking-normal font-normal">via {ispConfig.name}{ispConfig.connection_type ? ` · ${ispConfig.connection_type}` : ''}</span>}
                        {latestDirect.client_isp && latestDirect.client_isp !== ispConfig?.name && (
                          <span className="text-slate-600 normal-case tracking-normal font-normal">· detected: {latestDirect.client_isp}</span>
                        )}
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Latest Download" color={downColor(latestDirect.download_mbps ?? 0)}
                          border={planDown > 0 && (latestDirect.download_mbps ?? 0) < planDown * 0.8 ? 'border-red-500/30' : 'border-[#1a1a30]'}
                          value={planDown > 0 ? `${latestDirect.download_mbps} Mbps (${Math.round((latestDirect.download_mbps / planDown) * 100)}%)` : `${latestDirect.download_mbps} Mbps`} />
                        <StatCard label="Latest Upload" color={upColor(latestDirect.upload_mbps ?? 0)}
                          border={planUp > 0 && (latestDirect.upload_mbps ?? 0) < planUp * 0.8 ? 'border-red-500/30' : 'border-[#1a1a30]'}
                          value={planUp > 0 ? `${latestDirect.upload_mbps} Mbps (${Math.round((latestDirect.upload_mbps / planUp) * 100)}%)` : `${latestDirect.upload_mbps} Mbps`} />
                        <StatCard label="Latest Ping" value={`${latestDirect.ping_ms} ms`} color="text-violet-400" border="border-[#1a1a30]" />
                        <StatCard label={`Avg (${directRows.length})`} value={`↓${avgDown} ↑${avgUp}`} color="text-indigo-400" border="border-[#1a1a30]" />
                      </div>
                    </div>
                  )}

                  {/* VPN stat cards — only when VPN tests have been run */}
                  {latestVpn && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" /> VPN ({vpnRows.length} test{vpnRows.length !== 1 ? 's' : ''})
                        {latestVpn.client_isp && <span className="text-slate-600 normal-case tracking-normal font-normal">via {latestVpn.client_isp}{latestVpn.client_city ? `, ${latestVpn.client_city}` : ''}{latestVpn.client_country ? ` (${latestVpn.client_country})` : ''}</span>}
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Latest Download (VPN)" color="text-emerald-400" border="border-violet-500/20"
                          value={`${latestVpn.download_mbps} Mbps`} />
                        <StatCard label="Latest Upload (VPN)" color="text-sky-400" border="border-violet-500/20"
                          value={`${latestVpn.upload_mbps} Mbps`} />
                        <StatCard label="Latest Ping (VPN)" value={`${latestVpn.ping_ms} ms`} color="text-violet-400" border="border-violet-500/20" />
                        <StatCard label={`Avg VPN (${vpnRows.length})`} value={`↓${avgDownV} ↑${avgUpV}`} color="text-violet-300" border="border-violet-500/20" />
                      </div>
                    </div>
                  )}

                  {/* Hint when VPN is configured but no tests have been run yet */}
                  {!latestVpn && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-violet-500/15 bg-[#0a0a18] text-[11px]">
                      <Shield className="w-4 h-4 text-violet-500/40 flex-shrink-0" />
                      <span className="text-violet-400/60 font-medium">No VPN speed tests yet</span>
                      <span className="text-slate-600">· click <span className="text-violet-400 font-medium">Run VPN</span> (top-right) to measure{networkConfig?.vpn_interface ? <> <span className="font-mono">{networkConfig.vpn_interface}</span></> : ' VPN'} throughput and compare with direct</span>
                    </div>
                  )}

                  {/* SLA compliance banner — direct only */}
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
                            <span className="text-xs font-normal text-slate-500 ml-2">(direct only)</span>
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
                            {planDown > 0 && <span>↓ avg: <span className={`font-semibold ${downColor(parseFloat(avgDown))}`}>{avgDown} Mbps{avgDownPct != null ? ` (${avgDownPct}%)` : ''}</span></span>}
                            {planUp   > 0 && <span>↑ avg: <span className={`font-semibold ${upColor(parseFloat(avgUp))}`}>{avgUp} Mbps{avgUpPct != null ? ` (${avgUpPct}%)` : ''}</span></span>}
                            {planDown > 0 && <span className={belowDown > 0 ? 'text-red-400' : 'text-slate-600'}>{belowDown}/{directRows.length} tests below 80% download SLA</span>}
                            {planUp   > 0 && <span className={belowUp   > 0 ? 'text-red-400' : 'text-slate-600'}>{belowUp}/{directRows.length} tests below 80% upload SLA</span>}
                          </p>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Chart type pill selector */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-600 mr-0.5">Chart</span>
                    {[{ id: 'line', label: 'Line' }, { id: 'bar', label: 'Bar' }].map(ct => (
                      <button key={ct.id} onClick={() => setSpeedChartType(ct.id)}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors border ${
                          speedChartType === ct.id
                            ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                            : 'bg-transparent border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40'
                        }`}>
                        {ct.label}
                      </button>
                    ))}
                  </div>

                  {/* Trend charts — split Direct / VPN side by side when VPN data exists */}
                  {vpnRows.length > 0 ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {/* Direct chart */}
                      <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                        <div className="flex items-start justify-between mb-3">
                          <p className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Direct
                          </p>
                          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                            <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                              <span className="inline-block w-5 border-t-2 border-emerald-500 rounded" /> ↓
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                              <span className="inline-block w-5 border-t-2 border-sky-400 rounded" /> ↑
                            </span>
                            {planDown > 0 && <span className="flex items-center gap-1.5 text-[10px] text-emerald-400/60"><span className="inline-block w-5 border-t-2 border-dashed border-emerald-500/60" /> {planDown}M</span>}
                            {planUp   > 0 && <span className="flex items-center gap-1.5 text-[10px] text-sky-400/60"><span className="inline-block w-5 border-t-2 border-dashed border-sky-400/60" /> {planUp}M</span>}
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={180}>
                          {speedChartType === 'bar' ? (
                            <BarChart data={directChartRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                              <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                                tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" M" />
                              <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                              <Bar dataKey="direct_down" name="Direct ↓" fill="#10b981" unit=" Mbps" radius={[2,2,0,0]} />
                              <Bar dataKey="direct_up"   name="Direct ↑" fill="#38bdf8" unit=" Mbps" radius={[2,2,0,0]} />
                              {planDown > 0 && <ReferenceLine y={planDown} stroke="#10b981" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planDown}`, fill: '#10b981', fontSize: 9, opacity: 0.7 }} />}
                              {planUp   > 0 && <ReferenceLine y={planUp}   stroke="#38bdf8" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planUp}`,   fill: '#38bdf8', fontSize: 9, opacity: 0.7 }} />}
                            </BarChart>
                          ) : (
                            <LineChart data={directChartRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                              <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                                tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" M" />
                              <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                              <Line type="monotone" dataKey="direct_down" name="Direct ↓" stroke="#10b981" dot={{ r: 2 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                              <Line type="monotone" dataKey="direct_up"   name="Direct ↑" stroke="#38bdf8" dot={{ r: 2 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                              {planDown > 0 && <ReferenceLine y={planDown} stroke="#10b981" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planDown}`, fill: '#10b981', fontSize: 9, opacity: 0.7 }} />}
                              {planUp   > 0 && <ReferenceLine y={planUp}   stroke="#38bdf8" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planUp}`,   fill: '#38bdf8', fontSize: 9, opacity: 0.7 }} />}
                            </LineChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                      {/* VPN chart */}
                      <div className="bg-[#0a0a18] border border-violet-500/20 rounded-xl p-4">
                        <div className="flex items-start justify-between mb-3">
                          <p className="text-xs font-medium text-violet-400/80 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" /> VPN
                            {latestVpn?.client_isp && <span className="text-violet-600 font-normal text-[10px]">via {latestVpn.client_isp}</span>}
                          </p>
                          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                            <span className="flex items-center gap-1.5 text-[10px] text-violet-400/80">
                              <span className="inline-block w-5 border-t-2 border-violet-400" /> ↓
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] text-orange-400/80">
                              <span className="inline-block w-5 border-t-2 border-orange-400" /> ↑
                            </span>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={180}>
                          {speedChartType === 'bar' ? (
                            <BarChart data={vpnChartRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                              <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                                tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" M" />
                              <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                              <Bar dataKey="vpn_down" name="VPN ↓" fill="#a78bfa" unit=" Mbps" radius={[2,2,0,0]} />
                              <Bar dataKey="vpn_up"   name="VPN ↑" fill="#fb923c" unit=" Mbps" radius={[2,2,0,0]} />
                            </BarChart>
                          ) : (
                            <LineChart data={vpnChartRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                              <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                                tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" M" />
                              <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                              <Line type="monotone" dataKey="vpn_down" name="VPN ↓" stroke="#a78bfa" dot={{ r: 2 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                              <Line type="monotone" dataKey="vpn_up"   name="VPN ↑" stroke="#fb923c" dot={{ r: 2 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                            </LineChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : (
                  <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4">
                    <div className="flex items-start justify-between mb-3">
                      <p className="text-xs font-medium text-slate-400">Download &amp; Upload Trend</p>
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span className="inline-block w-5 border-t-2 border-emerald-500 rounded" /> Direct ↓
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span className="inline-block w-5 border-t-2 border-sky-400 rounded" /> Direct ↑
                        </span>
                        {planDown > 0 && (
                          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400/60">
                            <span className="inline-block w-5 border-t-2 border-dashed border-emerald-500/60" />
                            Plan ↓ {planDown} Mbps
                          </span>
                        )}
                        {planUp > 0 && (
                          <span className="flex items-center gap-1.5 text-[10px] text-sky-400/60">
                            <span className="inline-block w-5 border-t-2 border-dashed border-sky-400/60" />
                            Plan ↑ {planUp} Mbps
                          </span>
                        )}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      {speedChartType === 'bar' ? (
                        <BarChart data={directChartRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                          <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                            tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" M" />
                          <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                          <Bar dataKey="direct_down" name="Direct ↓" fill="#10b981" unit=" Mbps" radius={[2,2,0,0]} />
                          <Bar dataKey="direct_up"   name="Direct ↑" fill="#38bdf8" unit=" Mbps" radius={[2,2,0,0]} />
                          {planDown > 0 && <ReferenceLine y={planDown} stroke="#10b981" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planDown} Mbps`, fill: '#10b981', fontSize: 9, opacity: 0.7 }} />}
                          {planUp   > 0 && <ReferenceLine y={planUp}   stroke="#38bdf8" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planUp} Mbps`,   fill: '#38bdf8', fontSize: 9, opacity: 0.7 }} />}
                        </BarChart>
                      ) : (
                        <LineChart data={directChartRows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" vertical={false} />
                          <XAxis dataKey="ts" tick={{ fill: '#64748b', fontSize: 10 }}
                            tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} unit=" M" />
                          <ChartTooltip content={<ChartTip />} labelFormatter={v => fmtDate(v)} />
                          <Line type="monotone" dataKey="direct_down" name="Direct ↓" stroke="#10b981" dot={{ r: 2 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                          <Line type="monotone" dataKey="direct_up"   name="Direct ↑" stroke="#38bdf8" dot={{ r: 2 }} strokeWidth={1.5} unit=" Mbps" connectNulls={false} />
                          {planDown > 0 && <ReferenceLine y={planDown} stroke="#10b981" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planDown} Mbps`, fill: '#10b981', fontSize: 9, opacity: 0.7 }} />}
                          {planUp   > 0 && <ReferenceLine y={planUp}   stroke="#38bdf8" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: `${planUp} Mbps`,   fill: '#38bdf8', fontSize: 9, opacity: 0.7 }} />}
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                  )}

                  {/* Direct Speed Test History */}
                  {directRows.length > 0 && (
                  <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1a1a30]">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      <p className="text-xs font-semibold text-slate-300">Direct Speed Test History</p>
                      <span className="text-[10px] text-slate-500">{directRows.length} test{directRows.length !== 1 ? 's' : ''}</span>
                      {(() => {
                        const opts = [...new Set(directRows.map(r => String(r.server_name ?? r.server_host ?? '').replace(' [object Object]', '')).filter(Boolean))].map(s => ({ value: s, label: s }))
                        return opts.length > 1 ? (
                          <div className="ml-auto">
                            <MultiSelectDropdown label="Server" options={opts} selected={speedtestServerFilter} onApply={setSpeedtestServerFilter} />
                          </div>
                        ) : null
                      })()}
                    </div>
                    <div className="overflow-x-auto max-h-72 overflow-y-auto text-[11px]">
                      <table className="w-full min-w-[560px]">
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
                          {directRows.filter(r => {
                            if (speedtestServerFilter.length > 0) {
                              const sk = String(r.server_name ?? r.server_host ?? '').replace(' [object Object]', '')
                              if (!speedtestServerFilter.includes(sk)) return false
                            }
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
                              <td className="px-3 py-1.5 text-slate-500 truncate max-w-[160px]">
                                {String(r.server_name ?? r.server_host ?? '—').replace(' [object Object]', '')}
                                {r.provider === 'ookla' && <span className="ml-1.5 text-[9px] font-semibold text-amber-500/70 uppercase tracking-wide">Ookla</span>}
                              </td>
                            </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  )}

                  {/* VPN Speed Test History */}
                  {vpnRows.length > 0 && (
                  <div className="bg-[#0a0a18] border border-violet-500/20 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-500/15">
                      <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                      <p className="text-xs font-semibold text-violet-300">VPN Speed Test History</p>
                      <span className="text-[10px] text-violet-600">{vpnRows.length} test{vpnRows.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="overflow-x-auto max-h-72 overflow-y-auto text-[11px]">
                      <table className="w-full min-w-[560px]">
                        <thead className="sticky top-0 bg-[#0a0a18]">
                          <tr className="border-b border-violet-500/15">
                            <th className="px-3 py-2 text-left text-slate-400">Time</th>
                            <th className="px-3 py-2 text-right text-violet-400/70">↓ Down</th>
                            <th className="px-3 py-2 text-right text-violet-400/70">↑ Up</th>
                            <th className="px-3 py-2 text-right text-slate-400">Ping</th>
                            <th className="px-3 py-2 text-left text-slate-400">Exit ISP</th>
                            <th className="px-3 py-2 text-left text-slate-400">Client IP</th>
                            <th className="px-3 py-2 text-left text-slate-400">Server</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vpnRows.filter(r => {
                            if (speedtestSearch) {
                              const s = speedtestSearch.toLowerCase()
                              return (r.server_name ?? r.server_host ?? '').toLowerCase().includes(s) ||
                                     (r.client_isp ?? '').toLowerCase().includes(s) ||
                                     (r.client_ip  ?? '').toLowerCase().includes(s)
                            }
                            return true
                          }).map((r, i) => (
                            <tr key={i} className="border-b border-[#1a1a30] hover:bg-violet-950/10">
                              <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{fmtDate(r.ts)}</td>
                              <td className="px-3 py-1.5 text-right font-medium text-emerald-400">{r.download_mbps ?? '—'} Mbps</td>
                              <td className="px-3 py-1.5 text-right font-medium text-sky-400">{r.upload_mbps ?? '—'} Mbps</td>
                              <td className="px-3 py-1.5 text-right text-violet-400">{r.ping_ms ?? '—'} ms</td>
                              <td className="px-3 py-1.5 text-violet-400/70 max-w-[140px] truncate">{r.client_isp ?? '—'}</td>
                              <td className="px-3 py-1.5 text-slate-500 font-mono">{r.client_ip ?? '—'}</td>
                              <td className="px-3 py-1.5 text-slate-500 truncate max-w-[160px]">{String(r.server_name ?? r.server_host ?? '—').replace(' [object Object]', '')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  )}
                </>
              )
            })() : (
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-slate-600">
                <Zap className="w-8 h-8 opacity-30" />
                <p className="text-sm">No speed tests in this range</p>
                <button onClick={handleRunSpeedtest} disabled={running || runningVpn}
                  className="mt-1 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 rounded-lg transition-colors disabled:opacity-40">
                  <Zap className="w-3.5 h-3.5" />
                  Run Direct Test
                </button>
              </div>
            )}
          </>
          )
        })()}

        {/* ── DDNS ── */}
        {tab === 'ddns' && (() => {
          const ds = ddnsData?.status ?? null
          const history = ddnsData?.history ?? []
          const ipChanges = history.filter(e => e.event === 'ip_changed')
          const failures  = history.filter(e => e.event === 'update_failed')

          const providerLabel = {
            noip: 'No-IP', duckdns: 'DuckDNS', dynu: 'Dynu',
            dyndns: 'DynDNS', afraid: 'Afraid.org', cloudflare: 'Cloudflare',
          }

          // How long the current IP has been stable (since most recent ip_changed event)
          // eslint-disable-next-line react-hooks/purity
          const now        = Date.now()
          const lastChange = ipChanges[0]?.ts ?? ds?.last_updated ?? null
          const stableMs   = lastChange ? now - lastChange : null
          function fmtDur(ms) {
            if (ms == null) return '—'
            const s = Math.floor(ms / 1000)
            if (s < 120)       return `${s}s`
            const m = Math.floor(s / 60)
            if (m < 120)       return `${m}m`
            const h = Math.floor(m / 60)
            if (h < 48)        return `${h}h`
            return `${Math.floor(h / 24)}d`
          }

          // Check health: warn if last_check is older than 2.5× the configured interval
          const intervalMs   = (ds?.interval ?? 15) * 60 * 1000
          const checkAge     = ds?.last_check ? now - ds.last_check : null
          const checkStale   = checkAge != null && checkAge > intervalMs * 2.5

          return (
            <div className="space-y-5">

              {/* ── Hero banner ───────────────────────────────────────── */}
              <div className={`rounded-xl border px-5 py-4 flex flex-col md:flex-row md:items-center gap-4 ${
                ds?.enabled ? 'bg-emerald-950/20 border-emerald-500/20' : 'bg-[#0a0a18] border-amber-500/20'
              }`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${ds?.enabled ? 'bg-emerald-500/15' : 'bg-amber-500/10'}`}>
                    <Globe className={`w-5 h-5 ${ds?.enabled ? 'text-emerald-400' : 'text-amber-400'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-bold text-white font-mono truncate">{ds?.hostname ?? '(hostname not set)'}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        ds?.enabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      }`}>{ds?.enabled ? 'Active' : 'Disabled'}</span>
                      {checkStale && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-500/10 border-amber-500/30 text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" /> Checks stale
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {providerLabel[ds?.provider] ?? ds?.provider} · checked every {ds?.interval ?? '?'} min
                      {ds?.last_check && (
                        <> · last check <span className={checkStale ? 'text-amber-400' : 'text-slate-400'}>{fmtDate(ds.last_check)}</span></>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="flex gap-6 text-center">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Current IP</p>
                      <p className={`text-sm font-mono font-bold ${ds?.last_ip ? 'text-emerald-300' : 'text-slate-600'}`}>{ds?.last_ip ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">IP Stable For</p>
                      <p className="text-sm font-mono font-bold text-sky-300">{fmtDur(stableMs)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Last Updated</p>
                      <p className="text-sm text-slate-300">{ds?.last_updated ? new Date(ds.last_updated).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                    </div>
                  </div>
                  <Tooltip tip={!ds?.enabled ? 'DDNS is disabled in settings' : 'Check your public IP now and update the DDNS hostname if it has changed'}>
                    <button
                      onClick={handleForceDdnsCheck}
                      disabled={ddnsChecking || !ds?.enabled}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {ddnsChecking
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</>
                        : <><RefreshCw className="w-3.5 h-3.5" /> Check Now</>
                      }
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Last error banner */}
              {ds?.last_error && (
                <div className="flex items-start gap-3 bg-red-950/30 border border-red-500/30 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-400 mb-0.5">Last update error</p>
                    <p className="text-[11px] text-red-300 font-mono">{ds.last_error}</p>
                  </div>
                </div>
              )}

              {/* ── Stat cards ─────────────────────────────────────────── */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Provider',       value: providerLabel[ds?.provider] ?? ds?.provider ?? '—', color: 'text-sky-300' },
                  { label: 'Dynamic Host',   value: ds?.hostname ?? '—', color: ds?.hostname ? 'text-indigo-300' : 'text-slate-600', mono: true, small: true },
                  { label: 'Current IP',     value: ds?.last_ip ?? '—', color: ds?.last_ip ? 'text-emerald-300' : 'text-slate-600', mono: true },
                  { label: 'IP Stable For',  value: fmtDur(stableMs), color: 'text-sky-300', mono: true },
                  { label: 'IP Changes',     value: ipChanges.length, color: 'text-violet-300' },
                  { label: 'Failed Updates', value: failures.length,  color: failures.length > 0 ? 'text-red-400' : 'text-slate-500' },
                ].map(({ label, value, color, mono, small }) => (
                  <div key={label} className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl px-4 py-3">
                    <p className="text-[11px] text-slate-500 mb-1">{label}</p>
                    <p className={`font-bold tabular-nums truncate ${color} ${mono ? 'font-mono' : ''} ${small ? 'text-sm' : 'text-lg'}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* ── Port Exposure ──────────────────────────────────────── */}
              {(() => {
                const scan = ds?.port_scan ?? null
                const openPorts = scan?.results?.filter(r => r.open) ?? []
                return (
                  <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#1a1a30] flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">Port Exposure</span>
                        {scan && <span className="text-[10px] text-slate-600">scanned {fmtDate(scan.ts)} · {scan.ip}</span>}
                        {openPorts.length > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                            {openPorts.length} open
                          </span>
                        )}
                        {scan && openPorts.length === 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                            all closed
                          </span>
                        )}
                      </div>
                      <Tooltip tip={!ds?.last_ip ? 'Run a DDNS check first to detect your IP' : 'Scan your public IP address for open or exposed ports'}>
                        <button
                          onClick={handlePortScan}
                          disabled={ddnsPortScanning || !ds?.last_ip}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600/20 border border-violet-500/40 text-violet-300 hover:bg-violet-600/30 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {ddnsPortScanning
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning…</>
                            : <><Activity className="w-3.5 h-3.5" /> Scan Ports</>
                          }
                        </button>
                      </Tooltip>
                    </div>
                    {!scan ? (
                      <div className="py-10 flex flex-col items-center gap-2 text-slate-600">
                        <Activity className="w-7 h-7 opacity-30" />
                        <p className="text-sm">No scan results yet</p>
                        <p className="text-xs text-slate-700">Click <span className="text-violet-500">Scan Ports</span> to probe your public IP for open ports</p>
                      </div>
                    ) : (
                      <div className="p-4">
                        <div className="flex flex-wrap gap-2">
                          {scan.results.map(r => (
                            <div key={r.port} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono ${
                              r.open
                                ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                                : 'bg-[#0d0d1a] border-[#1a1a30] text-slate-600'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.open ? 'bg-amber-400' : 'bg-slate-700'}`} />
                              <span className="font-bold">{r.port}</span>
                              {r.service && <span className={r.open ? 'text-amber-500/70' : 'text-slate-700'}>{r.service}</span>}
                              <span className={`text-[10px] font-sans ${r.open ? 'text-amber-500' : 'text-slate-700'}`}>{r.open ? 'open' : 'closed'}</span>
                            </div>
                          ))}
                        </div>
                        {openPorts.length > 0 && (
                          <p className="mt-3 text-[11px] text-slate-600">
                            Open ports are reachable from the internet — verify these match your intended port forwards.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── IP change history ───────────────────────────────────── */}
              <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a30] flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">IP Change History</span>
                  <span className="text-[11px] text-slate-500">{ipChanges.length} change{ipChanges.length !== 1 ? 's' : ''} recorded</span>
                </div>
                {ipChanges.length === 0 ? (
                  <div className="py-10 flex flex-col items-center gap-2 text-slate-600">
                    <Globe className="w-7 h-7 opacity-30" />
                    <p className="text-sm">No IP changes recorded yet — your IP will be logged here when it changes</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#1a1a30] bg-[#080810]">
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Time</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Held for</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Old IP</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">New IP</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Provider Response</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#0f0f20]">
                        {ipChanges.map((e, i) => {
                          const prev = ipChanges[i + 1]  // history is newest-first
                          const heldMs = prev ? e.ts - prev.ts : null
                          return (
                            <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                              <td className="px-4 py-2 text-slate-400 tabular-nums whitespace-nowrap">{fmtDate(e.ts)}</td>
                              <td className="px-4 py-2 font-mono text-sky-300 text-[11px]">{heldMs != null ? fmtDur(heldMs) : <span className="text-slate-700 italic">first record</span>}</td>
                              <td className="px-4 py-2 font-mono text-slate-500">{e.old_ip ?? <span className="text-slate-700 italic">—</span>}</td>
                              <td className="px-4 py-2 font-mono text-emerald-300 font-semibold">{e.new_ip}</td>
                              <td className="px-4 py-2 text-slate-500 font-mono text-[11px]">{e.response ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Failed updates ─────────────────────────────────────── */}
              {failures.length > 0 && (
                <div className="bg-[#0a0a18] border border-red-500/20 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-red-500/20 flex items-center justify-between">
                    <span className="text-sm font-semibold text-red-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Failed Updates
                    </span>
                    <span className="text-[11px] text-red-500/60">{failures.length} failure{failures.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#1a1a30] bg-[#080810]">
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Time</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Provider</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">IP at time</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#0f0f20]">
                        {failures.map((e, i) => (
                          <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-2 text-slate-400 tabular-nums whitespace-nowrap">{fmtDate(e.ts)}</td>
                            <td className="px-4 py-2 text-slate-300">{providerLabel[e.provider] ?? e.provider ?? '—'}</td>
                            <td className="px-4 py-2 font-mono text-slate-400">{e.ip ?? '—'}</td>
                            <td className="px-4 py-2 text-red-400">{e.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Full event log ─────────────────────────────────────── */}
              {history.length > 0 && (
                <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#1a1a30]">
                    <span className="text-sm font-semibold text-white">Full Event Log</span>
                    <span className="text-[11px] text-slate-500 ml-2">{history.length} events (newest first, max 200)</span>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#080810] z-10">
                        <tr className="border-b border-[#1a1a30]">
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Time</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Event</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">User</th>
                          <th className="px-4 py-2 text-left text-slate-500 font-medium">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#0f0f20]">
                        {history.map((e, i) => (
                          <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-2 text-slate-500 tabular-nums whitespace-nowrap">{fmtDate(e.ts)}</td>
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                                e.event === 'ip_changed'
                                  ? 'text-emerald-400 bg-emerald-500/10'
                                  : e.event === 'force_update'
                                  ? 'text-sky-400 bg-sky-500/10'
                                  : e.event === 'port_scan'
                                  ? 'text-violet-400 bg-violet-500/10'
                                  : 'text-red-400 bg-red-500/10'
                              }`}>{
                                e.event === 'ip_changed' ? 'IP changed'
                                  : e.event === 'force_update' ? 'Force update'
                                  : e.event === 'port_scan' ? 'Port scan'
                                  : 'Update failed'
                              }</span>
                            </td>
                            <td className="px-4 py-2 text-violet-400 font-mono text-[11px]">
                              {(!e.triggered_by || e.triggered_by === 'system') ? '' : e.triggered_by}
                            </td>
                            <td className="px-4 py-2 text-slate-400 font-mono text-[11px]">
                              {e.event === 'ip_changed' || e.event === 'force_update'
                                ? `${e.old_ip ?? '?'} → ${e.new_ip}`
                                : e.event === 'port_scan'
                                ? (() => {
                                    const open = (e.results ?? []).filter(r => r.open)
                                    return open.length > 0
                                      ? `${open.length} open: ${open.map(r => r.port).join(', ')}`
                                      : 'all closed'
                                  })()
                                : e.error ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )
        })()}

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
                <div className="flex items-center justify-center py-16 text-slate-500 text-sm">No events in this range</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#1a1a30]">
                        <th className="px-4 py-2 text-left text-slate-500 font-medium w-36">Time</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium w-36">Event</th>
                        <th className="px-4 py-2 text-left text-slate-500 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#0f0f20]">
                      {events
                        .filter(ev => {
                          if (!activitySearch) return true
                          const s = activitySearch.toLowerCase()
                          const p = ev.payload ? (typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)) : ''
                          return ev.event?.toLowerCase().includes(s)
                            || ev.hostname?.toLowerCase().includes(s)
                            || ev.ip?.toLowerCase().includes(s)
                            || ev.mac?.toLowerCase().includes(s)
                            || p.toLowerCase().includes(s)
                        })
                        .map((ev, i) => {
                          const detail = fmtPayload(ev.event, ev.payload, ev)
                          const dur    = fmtDuration(ev.payload)
                          return (
                          <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="px-4 py-2.5 text-slate-500 tabular-nums whitespace-nowrap align-top">{fmtDate(ev.ts)}</td>
                            <td className="px-4 py-2.5 align-top">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${evColor(ev.event)}`}>
                                {evLabel(ev.event)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              <div className="space-y-0.5">
                                {/* Primary detail — hostname / name / main info */}
                                {(ev.hostname || ev.ip || ev.mac) && (
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    {ev.hostname && (
                                      <span className="text-white font-medium">{ev.hostname}</span>
                                    )}
                                    {ev.ip && (
                                      <span className="font-mono text-sky-400/80 text-[11px]">{ev.ip}</span>
                                    )}
                                    {ev.mac && (
                                      <span className="font-mono text-slate-500 text-[10px]">{ev.mac}</span>
                                    )}
                                  </div>
                                )}
                                {/* Secondary detail from payload */}
                                {detail && (
                                  <div className="text-slate-400 leading-relaxed">{detail}</div>
                                )}
                                {/* Duration inline if present */}
                                {dur && (
                                  <div className="text-slate-500 text-[11px]">Duration: {dur}</div>
                                )}
                              </div>
                            </td>
                          </tr>
                          )
                        })}
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

