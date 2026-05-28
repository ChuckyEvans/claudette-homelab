import { useState, useMemo } from 'react'
import { Shield, ShieldAlert, Monitor, Server, Router, Smartphone, ChevronDown, ChevronRight, Search, Globe, Hash, Cpu, Tag, Activity, Layers, Clock, Calendar, RefreshCw } from 'lucide-react'

const PORT_RISK = {
  23:    { risk: 'critical', label: 'Telnet',      note: 'Unencrypted remote shell' },
  2323:  { risk: 'critical', label: 'Telnet (alt)', note: 'Unencrypted remote shell' },
  512:   { risk: 'critical', label: 'rexec',        note: 'Unauthenticated remote exec' },
  513:   { risk: 'critical', label: 'rlogin',       note: 'Legacy unencrypted login' },
  514:   { risk: 'critical', label: 'rsh',          note: 'Unencrypted remote shell' },
  1900:  { risk: 'critical', label: 'UPnP',         note: 'Often exploited for NAT traversal' },
  5555:  { risk: 'critical', label: 'ADB',          note: 'Android Debug Bridge — remote shell' },
  21:    { risk: 'high',     label: 'FTP',          note: 'Unencrypted file transfer' },
  22:    { risk: 'high',     label: 'SSH',          note: 'Remote shell — verify is intended' },
  3389:  { risk: 'high',     label: 'RDP',          note: 'Windows remote desktop' },
  5900:  { risk: 'high',     label: 'VNC',          note: 'Remote desktop — often unencrypted' },
  5901:  { risk: 'high',     label: 'VNC-1',        note: 'Remote desktop' },
  5902:  { risk: 'high',     label: 'VNC-2',        note: 'Remote desktop' },
  8080:  { risk: 'high',     label: 'HTTP alt',     note: 'Unencrypted web service' },
  8888:  { risk: 'high',     label: 'HTTP alt',     note: 'Unencrypted web service' },
  3306:  { risk: 'high',     label: 'MySQL',        note: 'Database — should not be public' },
  5432:  { risk: 'high',     label: 'PostgreSQL',   note: 'Database — should not be public' },
  6379:  { risk: 'high',     label: 'Redis',        note: 'No auth by default in older versions' },
  27017: { risk: 'high',     label: 'MongoDB',      note: 'Database — often misconfigured' },
  80:    { risk: 'medium',   label: 'HTTP',         note: 'Unencrypted web server' },
  443:   { risk: 'medium',   label: 'HTTPS',        note: 'Encrypted web server' },
  25:    { risk: 'medium',   label: 'SMTP',         note: 'Mail server' },
  53:    { risk: 'medium',   label: 'DNS',          note: 'Domain name resolution' },
  110:   { risk: 'medium',   label: 'POP3',         note: 'Unencrypted mail retrieval' },
  143:   { risk: 'medium',   label: 'IMAP',         note: 'Unencrypted mail retrieval' },
  445:   { risk: 'medium',   label: 'SMB',          note: 'Windows file sharing' },
  139:   { risk: 'medium',   label: 'NetBIOS',      note: 'Windows networking' },
  2049:  { risk: 'medium',   label: 'NFS',          note: 'Network file system' },
  8443:  { risk: 'medium',   label: 'HTTPS alt',    note: 'Encrypted web service' },
  9090:  { risk: 'medium',   label: 'Web UI',       note: 'Admin web interface' },
  9100:  { risk: 'medium',   label: 'Printer',      note: 'JetDirect / raw print port' },
  548:   { risk: 'low',      label: 'AFP',          note: 'Apple file sharing' },
  631:   { risk: 'low',      label: 'IPP',          note: 'Printer' },
  5353:  { risk: 'low',      label: 'mDNS',         note: 'Local service discovery' },
  8009:  { risk: 'low',      label: 'AJP',          note: 'Tomcat connector' },
}

const RISK_ORDER  = { critical: 4, high: 3, medium: 2, low: 1, none: 0 }
const RISK_COLOUR = {
  critical: { badge: 'bg-red-950/80 text-red-400 border-red-900/50',         dot: 'bg-red-500',    text: 'text-red-400'    },
  high:     { badge: 'bg-orange-950/80 text-orange-400 border-orange-900/50', dot: 'bg-orange-500', text: 'text-orange-400' },
  medium:   { badge: 'bg-amber-950/80 text-amber-400 border-amber-900/50',    dot: 'bg-amber-500',  text: 'text-amber-400'  },
  low:      { badge: 'bg-blue-950/80 text-blue-400 border-blue-900/50',       dot: 'bg-blue-500',   text: 'text-blue-400'   },
  none:     { badge: 'bg-slate-900/80 text-slate-500 border-slate-800',       dot: 'bg-slate-700',  text: 'text-slate-500'  },
}

function portRisk(portNum) { return PORT_RISK[portNum] ?? { risk: 'none', label: null, note: null } }

function relTime(ms) {
  if (!ms) return null
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ms).toLocaleDateString('en-GB')
}

function inferDeviceType(d) {
  const v = (d.vendor ?? '').toLowerCase()
  const h = (d.hostname ?? '').toLowerCase()
  const os = (d.os ?? '').toLowerCase()
  if (v.includes('raspberry') || h.includes('pi')) return 'Single-board computer'
  if (v.includes('cisco') || v.includes('netgear') || v.includes('asus') || v.includes('tp-link') || h.includes('router') || h.includes('gateway')) return 'Router / Access point'
  if (os.includes('ios') || (v.includes('apple') && !(d.ports?.length))) return 'iPhone / iPad'
  if (os.includes('android') || v.includes('samsung') || v.includes('huawei') || v.includes('xiaomi') || v.includes('oneplus')) return 'Android device'
  if (os.includes('windows')) return 'Windows PC'
  if (os.includes('macos') || os.includes('mac os') || os.includes('darwin')) return 'Mac'
  if (os.includes('linux') || d.ports?.some(p => p.port === 22)) return 'Linux device'
  if (v.includes('apple')) return 'Apple device'
  return null
}

function guessIcon(device) {
  const v = (device.vendor ?? '').toLowerCase()
  const h = (device.hostname ?? '').toLowerCase()
  const os = (device.os ?? '').toLowerCase()
  if (v.includes('raspberry') || h.includes('pi')) return Server
  if (v.includes('cisco') || v.includes('netgear') || v.includes('asus') || v.includes('tp-link') || h.includes('router') || h.includes('gateway')) return Router
  if (os.includes('ios') || os.includes('android') || v.includes('apple') || v.includes('samsung') || v.includes('huawei') || v.includes('xiaomi') || v.includes('oneplus')) return Smartphone
  if (os.includes('windows') || os.includes('macos') || os.includes('darwin')) return Monitor
  if (device.ports?.some(p => [22, 80, 443, 8080].includes(p.port))) return Server
  return Monitor
}

function DeviceInfoRow({ icon: Icon, label, value, mono = false }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[#0a0a16] last:border-0">
      <Icon className="w-3 h-3 text-slate-600 mt-0.5 flex-shrink-0" />
      <span className="text-[11px] text-slate-500 w-20 flex-shrink-0">{label}</span>
      <span className={`text-[11px] text-slate-300 flex-1 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function deviceWorstRisk(openPorts) {
  if (!openPorts.length) return 'none'
  return openPorts.reduce((worst, p) => {
    const r = portRisk(p.port).risk
    return (RISK_ORDER[r] ?? 0) > (RISK_ORDER[worst] ?? 0) ? r : worst
  }, 'none')
}

function RiskBadge({ risk }) {
  const c = RISK_COLOUR[risk] ?? RISK_COLOUR.none
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider flex-shrink-0 ${c.badge}`}>
      {risk === 'none' ? 'clean' : risk}
    </span>
  )
}

function DeviceRow({ device }) {
  const [open, setOpen] = useState(false)
  const openPorts = (device.ports ?? []).filter(p => p.state === 'open')
  const worst = deviceWorstRisk(openPorts)
  const c = RISK_COLOUR[worst]
  const sortedPorts = [...openPorts].sort((a, b) => {
    const ra = RISK_ORDER[portRisk(a.port).risk] ?? 0
    const rb = RISK_ORDER[portRisk(b.port).risk] ?? 0
    return rb !== ra ? rb - ra : a.port - b.port
  })
  const label = device.label || device.hostname
  const Icon = guessIcon(device)
  const deviceType = inferDeviceType(device)
  const isOnline = device.status === 'online'
  const isFiltered = device.status === 'filtered'

  return (
    <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
        <Icon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="font-semibold text-sm text-slate-200 font-mono truncate">
            {label ? <><span className="font-sans text-slate-200">{label}</span></> : device.ip}
          </span>
          <span className="text-[11px] text-slate-500 font-mono truncate">
            {label ? device.ip : device.vendor}
          </span>
        </span>
        <span className={`text-[10px] flex-shrink-0 ${
          isOnline ? 'text-emerald-500' : isFiltered ? 'text-orange-500' : 'text-slate-600'
        }`}>{device.status ?? 'unknown'}</span>
        <span className="text-[11px] text-slate-400 flex-shrink-0 ml-1">{openPorts.length}p</span>
        <RiskBadge risk={worst} />
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-700" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-700" />}
      </button>
      {open && (
        <div className="border-t border-[#1a1a30]">
          {/* Device info */}
          <div className="px-4 py-2">
            <DeviceInfoRow icon={Globe}    label="IP"          value={device.ip}       mono />
            <DeviceInfoRow icon={Hash}     label="MAC"         value={device.mac}      mono />
            <DeviceInfoRow icon={Cpu}      label="Vendor"      value={device.vendor} />
            <DeviceInfoRow icon={Tag}      label="Type"        value={deviceType} />
            <DeviceInfoRow icon={Activity} label="Hostname"    value={device.hostname} mono />
            <DeviceInfoRow icon={Layers}   label="OS"          value={device.os} />
            <DeviceInfoRow icon={Clock}    label="Latency"     value={device.latency != null ? `${device.latency}ms` : null} />
            <DeviceInfoRow icon={Calendar} label="First seen"  value={relTime(device.firstSeen)} />
            <DeviceInfoRow icon={Calendar} label="Last seen"   value={relTime(device.lastSeen)} />
          </div>
          {/* Ports */}
          <div className="border-t border-[#1a1a30] divide-y divide-[#0a0a16]">
            {sortedPorts.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-600 italic">No open ports detected — run a deep scan for full results</p>
            ) : sortedPorts.map(p => {
              const info = portRisk(p.port)
              const rc = RISK_COLOUR[info.risk] ?? RISK_COLOUR.none
              return (
                <div key={`${p.port}/${p.protocol}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                  <span className={`font-mono text-sm font-medium w-14 flex-shrink-0 ${rc.text}`}>{p.port}</span>
                  <span className="text-[10px] text-slate-600 w-8 flex-shrink-0">{p.protocol ?? 'tcp'}</span>
                  <span className="text-xs text-slate-300 flex-1">{info.label ?? p.service ?? 'unknown'}</span>
                  {info.note && <span className="text-[11px] text-slate-500 flex-shrink-0 text-right max-w-[220px] truncate">{info.note}</span>}
                  {info.risk !== 'none' && <RiskBadge risk={info.risk} />}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const RISK_FILTERS = ['all', 'critical', 'high', 'medium', 'low', 'none']

export default function ThreatsPanel({ networkScan, onRefreshThreats }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const devices = networkScan?.devices ?? []

  const devicesWithPorts = useMemo(() => devices
    .map(d => {
      const openPorts = (d.ports ?? []).filter(p => p.state === 'open')
      return { ...d, _openPorts: openPorts, _worst: deviceWorstRisk(openPorts) }
    })
    .filter(d => filter === 'all' || d._worst === filter)
    .filter(d => {
      if (!search) return true
      const s = search.toLowerCase()
      return (d.label || '').toLowerCase().includes(s) ||
             (d.hostname || '').toLowerCase().includes(s) ||
             (d.ip || '').includes(s) ||
             (d.vendor || '').toLowerCase().includes(s)
    })
    .sort((a, b) => {
      const diff = (RISK_ORDER[b._worst] ?? 0) - (RISK_ORDER[a._worst] ?? 0)
      return diff !== 0 ? diff : (a.label || a.hostname || a.ip || '').localeCompare(b.label || b.hostname || b.ip || '')
    }), [devices, filter])

  const counts = useMemo(() => {
    const c = { all: devices.length }
    for (const f of RISK_FILTERS.slice(1)) {
      c[f] = devices.filter(d => deviceWorstRisk((d.ports ?? []).filter(p => p.state === 'open')) === f).length
    }
    return c
  }, [devices])

  const totalExposed = devices.filter(d =>
    (d.ports ?? []).filter(p => p.state === 'open').some(p => ['critical','high'].includes(portRisk(p.port).risk))
  ).length
  const totalPorts = devices.reduce((s, d) => s + (d.ports ?? []).filter(p => p.state === 'open').length, 0)
  const scanned = devices.filter(d => d.ports != null).length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Exposure</h1>
          <p className="text-slate-500 text-sm mt-1">
            {devices.length} device{devices.length !== 1 ? 's' : ''} · {scanned} scanned · {totalPorts} open port{totalPorts !== 1 ? 's' : ''}
            {totalExposed > 0 && <span className="ml-1.5 text-orange-400 font-medium">{totalExposed} with high/critical ports</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {['critical','high','medium','low'].map(r => counts[r] > 0 && (
            <span key={r} className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${RISK_COLOUR[r].badge}`}>
              {counts[r]} {r}
            </span>
          ))}
          {onRefreshThreats && (
            <button
              onClick={onRefreshThreats}
              title="Refresh threat data"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg transition-colors"
            >
              <RefreshCw className="w-3 h-3" />Refresh
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg overflow-hidden border border-[#2a2a45] w-fit">
          {RISK_FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-200 bg-[#0f0f20]'
              }`}>
              {f === 'none' ? 'clean' : f}
              {counts[f] > 0 && <span className={`ml-1 text-[10px] ${filter === f ? 'text-indigo-200' : 'text-slate-600'}`}>{counts[f]}</span>}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by IP, hostname…"
            className="bg-[#0a0a18] border border-[#2a2a45] focus:border-indigo-500/50 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none w-52"
          />
        </div>
      </div>

      {scanned === 0 ? (
        <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl px-6 py-12 text-center">
          <ShieldAlert className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No port scan data yet</p>
          <p className="text-slate-600 text-sm mt-1">Run a Deep Scan from the Network page to populate this view</p>
        </div>
      ) : devicesWithPorts.length === 0 ? (
        <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl px-6 py-12 text-center">
          <Shield className="w-10 h-10 text-emerald-400/30 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No devices match this filter</p>
        </div>
      ) : (
        <div className="space-y-2">
          {devicesWithPorts.map(d => <DeviceRow key={d.mac ?? d.ip} device={d} />)}
        </div>
      )}

      {scanned > 0 && (
        <div className="border border-[#1a1a30] rounded-xl p-4 text-[11px] text-slate-500 space-y-2">
          <p className="font-medium text-slate-400">Risk levels are based on known port classifications:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {['critical','high','medium','low'].map(r => (
              <div key={r} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${RISK_COLOUR[r].dot}`} />
                <span className="capitalize font-medium">{r}</span>
                <span className="text-slate-600">— {{
                  critical: 'telnet, UPnP, ADB',
                  high:     'SSH, RDP, VNC, databases',
                  medium:   'HTTP, SMB, DNS',
                  low:      'printing, discovery',
                }[r]}</span>
              </div>
            ))}
          </div>
          <p className="text-slate-600">Port risk reflects exposure potential, not confirmed vulnerability. Run regular deep scans for up-to-date data.</p>
        </div>
      )}
    </div>
  )
}