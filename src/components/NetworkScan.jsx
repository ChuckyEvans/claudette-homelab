import { useState, useEffect, useRef, useMemo } from 'react'
import { Network, Server, Monitor, Smartphone, Router, AlertCircle, AlertTriangle, Wifi, Search, RefreshCw, ChevronRight, Globe, Cpu, Hash, Clock, Activity, X, Share2, Layers, LayoutList, Map, Calendar, Tag, Trash2, Pencil, Check, Loader, Star } from 'lucide-react'
import { api } from '../lib/api.js'
import { deviceThreatLevel } from '../lib/threatMatch.js'

const WELL_KNOWN = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB',
  1883: 'MQTT', 3000: 'HTTP-dev', 3306: 'MySQL', 5432: 'Postgres',
  6379: 'Redis', 7081: 'SickGear', 8080: 'HTTP-alt', 8123: 'HomeAssist',
  8191: 'FlareSolvr', 8443: 'HTTPS-alt', 9091: 'Transmission', 9117: 'Jackett',
  27017: 'MongoDB', 32400: 'Plex', 8096: 'Jellyfin', 8920: 'Jellyfin-HTTPS',
  6881: 'BitTorrent', 51413: 'Transmission-peer',
}

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function ipInSubnet(ip, cidr) {
  try {
    const [net, prefix] = cidr.split('/')
    const bits = parseInt(prefix)
    const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0
    const toNum = s => s.split('.').reduce((a, o) => ((a << 8) | parseInt(o)) >>> 0, 0)
    return (toNum(ip) & mask) === (toNum(net) & mask)
  } catch { return false }
}

function sortDevices(arr) {
  return [...arr].sort((a, b) => {
    // 1. Favorites first
    const favA = a.favorited ? 0 : 1
    const favB = b.favorited ? 0 : 1
    if (favA !== favB) return favA - favB
    // 2. Online first
    const onA = a.status === 'online' ? 0 : 1
    const onB = b.status === 'online' ? 0 : 1
    if (onA !== onB) return onA - onB
    // 3. IP numerically
    const ipA = a.ip.split('.').map(Number)
    const ipB = b.ip.split('.').map(Number)
    for (let i = 0; i < 4; i++) if (ipA[i] !== ipB[i]) return ipA[i] - ipB[i]
    // 4. Hostname alphabetically
    const ha = a.hostname?.toLowerCase() || ''
    const hb = b.hostname?.toLowerCase() || ''
    return ha.localeCompare(hb)
  })
}

// ── Device Tree (left sidebar) ────────────────────────────────────────────────
function DeviceTree({ devices, selected, onSelect, scanning, portScanProgress = {}, subnets = [], threatMap = {}, myIp = null }) {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [activeSubnet, setActiveSubnet] = useState(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    const handler = () => setTick(t => t + 1)
    window.addEventListener('claudette:my-device-changed', handler)
    return () => window.removeEventListener('claudette:my-device-changed', handler)
  }, [])

  const visible = devices.filter(d => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return d.ip.includes(q) || (d.hostname ?? '').toLowerCase().includes(q) || (d.vendor ?? '').toLowerCase().includes(q) || (d.label ?? '').toLowerCase().includes(q)
  })

  const useGroups = subnets.length > 1

  // When a specific subnet is selected, filter to just that subnet (flat list)
  const displayDevices = activeSubnet === 'favorites'
    ? visible.filter(d => d.favorited)
    : activeSubnet
      ? visible.filter(d => ipInSubnet(d.ip, activeSubnet))
      : visible

  const groups = useGroups && !activeSubnet ? (() => {
    const assigned = new Set()
    const result = subnets.map(subnet => {
      const devs = visible.filter(d => ipInSubnet(d.ip, subnet))
      devs.forEach(d => assigned.add(d.ip))
      return { subnet, devices: devs }
    })
    const others = visible.filter(d => !assigned.has(d.ip))
    if (others.length) result.push({ subnet: 'Other', devices: others })
    return result
  })() : []

  const renderDevice = (d) => {
    const Icon = guessIcon(d)
    const isSelected = selected?.ip === d.ip
    const isOffline   = d.status === 'offline'
    const isFiltered  = d.status === 'filtered'
    const myDevice = localStorage.getItem('claudette:my-device')
    const isMe = myDevice
      ? (d.mac && d.mac === myDevice) || d.ip === myDevice
      : Array.isArray(myIp) ? myIp.includes(d.ip) : myIp === d.ip
    const openPorts = d.ports?.filter(p => p.state === 'open') ?? []
    return (
      <button
        key={d.ip}
        onClick={() => onSelect(d)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
          isSelected ? 'bg-indigo-600/15 border-r-2 border-indigo-500' : isMe ? 'bg-cyan-500/5 hover:bg-cyan-500/10' : 'hover:bg-white/[0.03]'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.status === 'online' ? 'bg-emerald-400' : d.status === 'filtered' ? 'bg-orange-400' : 'bg-slate-600'}`} />
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-indigo-400' : (isOffline || isFiltered) ? 'text-slate-500' : 'text-slate-400'}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium font-mono truncate flex items-center gap-1 ${isSelected ? 'text-slate-100' : (isOffline || isFiltered) ? 'text-slate-500' : 'text-slate-300'}`}>
            {d.favorited && <Star className="w-3 h-3 text-amber-400 flex-shrink-0" fill="currentColor" />}
            {d.label ? <span className="font-sans text-indigo-300">{d.label}</span> : d.ip}
            {portScanProgress[d.ip] != null && <Loader className="w-2.5 h-2.5 flex-shrink-0 text-indigo-400 animate-spin" />}
          </p>
          {(d.label ? d.ip : d.hostname) && (
            <p
              className={`text-[10px] font-mono truncate ${
                (isOffline || isFiltered) ? 'text-slate-500' :
                d.hostnameStale && !d.label ? 'text-slate-500 italic' : 'text-slate-400'
              }`}
              title={d.hostnameStale && !d.label ? 'Hostname from previous scan — not confirmed in latest scan' : undefined}
            >{d.label ? d.ip : d.hostname}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          {isMe && <span className="text-[9px] font-medium text-cyan-400 leading-none">you</span>}
          {isFiltered
            ? <span className="text-[10px] text-orange-500/70" title="Ping blocked but ports still respond">filtered</span>
            : isOffline
              ? <span className="text-[10px] text-slate-500">offline</span>
              : d.latency != null && <span className="text-[10px] font-mono text-slate-400">{d.latency}ms</span>
          }
          {openPorts.length > 0 && (
            <span className={`text-[10px] ${(isOffline || isFiltered) ? 'text-slate-500' : 'text-slate-400'}`}>{openPorts.length}p</span>
          )}
        </div>
        {threatMap[d.ip] === 'critical' && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" title="Critical threat detected" />}
        {threatMap[d.ip] === 'high'     && <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0" title="High severity threat detected" />}
        {threatMap[d.ip] === 'medium'   && <AlertCircle   className="w-3 h-3 text-amber-400 flex-shrink-0" title="Medium severity threat detected" />}
        {isSelected && <ChevronRight className="w-3 h-3 text-indigo-500 flex-shrink-0" />}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#080812] border-r border-[#1a1a30]">
      <div className="px-3 py-3 border-b border-[#1a1a30]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Filter devices…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full bg-[#0f0f20] border border-[#1a1a30] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <p className="text-[11px] text-slate-400 mt-2 px-0.5">
          {devices.length > 0
            ? (() => {
                const on  = devices.filter(d => d.status === 'online').length
                const fi  = devices.filter(d => d.status === 'filtered').length
                const off = devices.filter(d => d.status === 'offline').length
                return `${on} online${fi > 0 ? ` · ${fi} filtered` : ''} · ${off} offline`
              })()
            : scanning ? 'Scanning…' : 'No devices yet'}
        </p>
      </div>

      {/* Subnet / Favorites filter dropdown */}
      {(useGroups || visible.some(d => d.favorited)) && (
        <div className="px-3 pb-2.5 border-b border-[#1a1a30]">
          <select
            value={activeSubnet ?? ''}
            onChange={e => setActiveSubnet(e.target.value || null)}
            className="w-full bg-[#0f0f20] border border-[#1a1a30] rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
          >
            <option value="">All ({visible.length})</option>
            <option value="favorites">★ Favorites ({visible.filter(d => d.favorited).length})</option>
            {subnets.map(s => {
              const count = visible.filter(d => ipInSubnet(d.ip, s)).length
              return <option key={s} value={s}>{s}  ({count} devices)</option>
            })}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {useGroups && !activeSubnet ? (
          groups.map(({ subnet, devices: groupDevices }) => {
            if (groupDevices.length === 0) return null
            const isCollapsed = !!collapsed[subnet]
            const online = groupDevices.filter(d => d.status === 'online').length
            return (
              <div key={subnet}>
                <button
                  onClick={() => setCollapsed(p => ({ ...p, [subnet]: !p[subnet] }))}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-white/[0.02] border-b border-t border-[#1a1a30] bg-[#0a0a18]"
                >
                  <ChevronRight className={`w-3 h-3 text-slate-500 transition-transform flex-shrink-0 ${!isCollapsed ? 'rotate-90' : ''}`} />
                  <span className="text-[10px] font-mono text-indigo-400/70 flex-1 truncate">{subnet}</span>
                  <span className="text-[10px] text-slate-400">{online}/{groupDevices.length}</span>
                </button>
                {!isCollapsed && sortDevices(groupDevices).map(renderDevice)}
              </div>
            )
          })
        ) : (
          sortDevices(displayDevices).map(renderDevice)
        )}
      </div>
    </div>
  )
}

// ── Detail panel (right) ──────────────────────────────────────────────────────
function InfoRow({ icon: Icon, label, value, mono = false, note = null }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#1a1a30] last:border-0">
      <Icon className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
      <span className="text-xs text-slate-400 w-24 flex-shrink-0">{label}</span>
      <span className={`text-xs text-slate-300 flex-1 break-all ${mono ? 'font-mono' : ''}`}>
        {value}
        {note && <span className="ml-1.5 text-[10px] text-slate-600 italic">{note}</span>}
      </span>
    </div>
  )
}

function PortRow({ port }) {
  const label = WELL_KNOWN[port.port] || port.service || '—'
  const stateColor = port.state === 'open' ? 'text-emerald-400' : 'text-slate-500'
  // Extract first useful script line (e.g. http-title, http-server-header)
  const banner = port.scripts?.find(l => /^(http-title|http-server-header|ssh-hostkey|ssl-cert|ftp-anon)/.test(l))
    ?? port.scripts?.[0] ?? null
  return (
    <div className="border-b border-[#1a1a30] last:border-0">
      <div className="flex items-center gap-3 py-2 hover:bg-white/[0.02] px-4">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${port.state === 'open' ? 'bg-emerald-400' : 'bg-slate-700'}`} />
        <span className="text-xs font-mono text-slate-400 w-16 flex-shrink-0">{port.port}/{port.protocol}</span>
        <span className={`text-xs font-semibold w-16 flex-shrink-0 ${stateColor}`}>{label}</span>
        <span className="text-xs text-slate-400 flex-1 truncate">{port.version || port.service || ''}</span>
        <span className={`text-[10px] ${stateColor} flex-shrink-0`}>{port.state}</span>
      </div>
      {banner && (
        <p className="px-4 pb-1.5 text-[10px] text-slate-400 font-mono truncate pl-10">└ {banner}</p>
      )}
    </div>
  )
}

function DeviceDetail({ device, knownDevices, onDeviceUpdated, portScanProgress = {} }) {
  const [scanData, setScanData]     = useState(null)
  const [scanning, setScanning]     = useState(false)
  const [scanError, setScanError]   = useState(null)
  const [confirm, setConfirm]       = useState(null)
  const [labelEdit, setLabelEdit]   = useState(false)
  const [labelValue, setLabelValue] = useState(device.label ?? '')
  const [portSearch, setPortSearch] = useState('')
  const [, setTick] = useState(0)
  const labelRef = useRef(null)

  useEffect(() => {
    const handler = () => setTick(t => t + 1)
    window.addEventListener('claudette:my-device-changed', handler)
    return () => window.removeEventListener('claudette:my-device-changed', handler)
  }, [])
  const Icon = guessIcon(device)
  const d = scanData ?? device
  const openPorts = (d.ports ?? []).filter(p => p.state === 'open')
  const filteredPorts = portSearch
    ? openPorts.filter(p => {
        const s = portSearch.toLowerCase()
        return String(p.port).includes(s) ||
               (p.service || '').toLowerCase().includes(s) ||
               (WELL_KNOWN[p.port] || '').toLowerCase().includes(s)
      })
    : openPorts
  const hasCachedPorts = (device.ports ?? []).length > 0
  const livePercent = portScanProgress[device.ip] ?? null

  // Sync label value when device prop changes (e.g. different device selected)
  useEffect(() => { setLabelValue(device.label ?? ''); setLabelEdit(false) }, [device.mac])

  useEffect(() => { if (labelEdit && labelRef.current) labelRef.current.focus() }, [labelEdit])

  const saveLabel = async () => {
    if (!device.mac) return
    try {
      await api.network.setLabel(device.mac, labelValue)
      onDeviceUpdated?.({ ...device, label: labelValue.trim() || null })
      setLabelEdit(false)
    } catch (err) {
      console.error('Failed to save label', err)
    }
  }

  const handlePortScan = async () => {
    setScanning(true); setScanError(null)
    try {
      const result = await api.network.device(device.ip)
      setScanData(result)
      onDeviceUpdated?.({ ...device, ...result })
    } catch (err) {
      if (!err.message?.includes('cancel')) setScanError(err.message)
    } finally {
      setScanning(false)
    }
  }

  const handleCancelScan = async () => {
    try { await api.network.cancelDeviceScan(device.ip) } catch { /* ignore */ }
    setScanning(false)
    setScanError(null)
  }

  const labelHop = (address) => {
    const known = knownDevices?.find(kd => kd.ip === address)
    return known?.hostname ? `${known.hostname} (${address})` : address
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#1a1a30] flex items-center gap-4">
        <div className="relative w-12 h-12 bg-[#1a1a35] rounded-xl flex items-center justify-center flex-shrink-0">
          <Icon className="w-6 h-6 text-indigo-400" />
          {device.favorited && (
            <Star className="absolute -top-1.5 -right-1.5 w-4 h-4 text-amber-400 drop-shadow" fill="currentColor" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold truncate flex items-center gap-2">
              <span className={device.hostnameStale && device.hostname ? 'text-slate-300 italic' : 'text-white'}>
                {device.hostname || device.ip}
              </span>
              {livePercent != null && <Loader className="w-4 h-4 flex-shrink-0 text-indigo-400 animate-spin" />}
            </h2>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${device.status === 'online' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            <span className={`text-xs ${device.status === 'online' ? 'text-emerald-400' : 'text-slate-600'}`}>{device.status}</span>
          </div>
          {device.hostname && (
            <p className="text-sm text-slate-400 font-mono mt-0.5">
              {device.ip}
              {device.hostnameStale && <span className="ml-2 text-[10px] text-slate-600 italic">hostname unconfirmed</span>}
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-2xl font-bold text-indigo-400">{openPorts.length}</p>
          <p className="text-xs text-slate-400">open ports</p>
        </div>
        <button
          onClick={async () => {
            if (!device.mac) return
            try {
              const { favorited } = await api.network.toggleFavorite(device.mac)
              onDeviceUpdated?.({ ...device, favorited })
            } catch (err) { console.error('Failed to toggle favorite', err) }
          }}
          disabled={!device.mac}
          title={device.favorited ? 'Remove from favorites' : 'Add to favorites'}
          className={`p-2 border rounded-lg transition-colors flex-shrink-0 ${
            device.favorited
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25'
              : 'bg-[#0f0f1e] border-[#1a1a30] hover:border-amber-500/30 text-slate-500 hover:text-amber-400'
          }`}
        >
          <Star className="w-4 h-4" fill={device.favorited ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={() => {
            const key = device.mac || device.ip
            const current = localStorage.getItem('claudette:my-device')
            if (current === key) localStorage.removeItem('claudette:my-device')
            else localStorage.setItem('claudette:my-device', key)
            // force re-render by toggling a dummy state if needed — use window event
            window.dispatchEvent(new Event('claudette:my-device-changed'))
          }}
          title={localStorage.getItem('claudette:my-device') === (device.mac || device.ip) ? 'Unmark as my device' : 'Mark as my device'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-xs transition-colors flex-shrink-0 ${
            localStorage.getItem('claudette:my-device') === (device.mac || device.ip)
              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/25'
              : 'bg-[#0f0f1e] border-[#1a1a30] hover:border-cyan-500/30 text-slate-500 hover:text-cyan-400'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          {localStorage.getItem('claudette:my-device') === (device.mac || device.ip) ? 'My device' : 'My device?'}
        </button>
        <button
          onClick={() => hasCachedPorts && setConfirm({
            message: `Are you sure you want to clear all discovered ports for ${device.hostname || device.ip}?`,
            onConfirm: () => {
              setConfirm(null)
              api.network.clearPorts(device.mac).then(() => {
                setScanData(null)
                onDeviceUpdated?.({ ...device, ports: [], hostScripts: [], traceroute: [] })
              }).catch(console.error)
            },
          })}
          disabled={!hasCachedPorts}
          title={hasCachedPorts ? 'Clear discovered ports' : 'No ports to clear'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-900/20 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 text-red-500 hover:text-red-400 rounded-lg text-xs transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-900/20 disabled:hover:border-red-500/20 disabled:hover:text-red-500"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear Ports
        </button>
      </div>

      {/* Info rows */}
      <div className="px-6 py-2">
        <InfoRow icon={Globe}    label="IP Address"   value={device.ip}       mono />
        <InfoRow icon={Hash}     label="MAC Address"  value={device.mac}      mono />
        <InfoRow icon={Cpu}      label="Vendor"       value={device.vendor} />
        <InfoRow icon={Tag}      label="Device Type"  value={inferDeviceType(d)} />
        <InfoRow icon={Activity} label="Hostname"     value={device.hostname} note={device.hostnameStale ? 'unconfirmed' : null} />
        <InfoRow icon={Layers}   label="OS"           value={d.os} />
        <InfoRow icon={Clock}    label="Latency"      value={device.latency != null ? `${device.latency}ms` : null} />
        <InfoRow icon={Router}   label="Gateway"      value={device.detectedGateway} mono />
        <InfoRow icon={Calendar} label="First Seen"   value={relTime(device.firstSeen)} />
        <InfoRow icon={Calendar} label="Last Seen"    value={relTime(device.lastSeen)} />
        <InfoRow icon={Clock}    label="Port Scan"    value={(device.ports?.length && device.updatedAt) ? relTime(device.updatedAt) : null} />
      </div>

      {/* Device Label */}
      {device.mac && (
        <div className="px-6 py-3 border-t border-[#1a1a30]">
          <div className="flex items-center gap-2 mb-1.5">
            <Pencil className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Label</span>
          </div>
          {labelEdit ? (
            <div className="flex items-center gap-2">
              <input
                ref={labelRef}
                value={labelValue}
                onChange={e => setLabelValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setLabelEdit(false) }}
                placeholder="e.g. Raspberry Pi NAS"
                className="flex-1 bg-[#12122a] border border-indigo-500/40 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
              />
              <button onClick={saveLabel} className="p-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 rounded-lg text-indigo-400">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setLabelEdit(false)} className="p-1.5 bg-slate-700/20 hover:bg-slate-700/40 border border-slate-600/30 rounded-lg text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setLabelEdit(true)}
              className="flex items-center gap-2 text-sm text-left text-slate-300 hover:text-white bg-[#12122a] hover:bg-[#1a1a35] border border-[#2a2a45] hover:border-indigo-500/30 rounded-lg px-3 py-1.5 w-full transition-colors"
            >
              {device.label
                ? <><span className="text-indigo-300 font-medium">{device.label}</span><span className="ml-auto text-slate-500 text-xs">edit</span></>
                : <span className="text-slate-500 italic">Add a label…</span>
              }
            </button>
          )}
        </div>
      )}

      {/* Network Path */}
      {d.traceroute?.length > 0 && (
        <div className="px-6 py-3 border-t border-[#1a1a30]">
          <div className="flex items-center gap-2 mb-2">
            <Share2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Network Path</span>
          </div>
          <div className="space-y-1">
            {d.traceroute.map((hop, i) => (
              <div key={i} className="flex items-center gap-3 text-[11px]">
                <span className="text-slate-400 w-4 text-right font-mono">{hop.hop}</span>
                <span className="w-14 text-slate-400 font-mono">{hop.rtt}ms</span>
                <span className="text-slate-400 font-mono">{labelHop(hop.address)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ports */}
      <div className="flex-1 mt-2">
        <div className="flex items-center justify-between px-6 py-3 border-y border-[#1a1a30]">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Open Ports ({portSearch && filteredPorts.length !== openPorts.length ? `${filteredPorts.length} / ${openPorts.length}` : openPorts.length})
            {hasCachedPorts && !scanData && <span className="ml-2 text-[10px] text-slate-400 normal-case font-normal">from cache</span>}
          </h3>
          <div className="flex items-center gap-2">
            {openPorts.length > 4 && (
              <div className="relative">
                <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={portSearch}
                  onChange={e => setPortSearch(e.target.value)}
                  placeholder="Filter ports…"
                  className="bg-[#0a0a18] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg pl-6 pr-2 py-1 text-xs text-slate-300 placeholder-slate-600 outline-none w-28"
                />
              </div>
            )}
            {scanning && (
              <button onClick={handleCancelScan}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/25 hover:bg-red-900/45 border border-red-500/30 hover:border-red-500/55 text-red-400 hover:text-red-300 rounded-lg text-xs font-medium transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
            )}
            <button onClick={handlePortScan} disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/30 hover:border-indigo-500/55 text-indigo-400 hover:text-indigo-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
              {scanData ? 'Re-scan Ports' : 'Scan Ports'}
            </button>
          </div>
        </div>
        {scanning && (
          <div className="px-6 pb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-slate-400">
                Scanning ports on <span className="font-mono text-indigo-400">{device.ip}</span>
              </span>
              {livePercent != null && (
                <span className="text-[11px] text-slate-400 font-mono tabular-nums">{Math.round(livePercent)}%</span>
              )}
            </div>
            <div className="h-1 bg-[#1a1a30] rounded-full overflow-hidden">
              {livePercent != null
                ? <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${livePercent}%` }} />
                : <div className="h-full bg-indigo-500/60 rounded-full animate-pulse w-full" />}
            </div>
          </div>
        )}
        {scanError && <p className="px-6 py-3 text-xs text-red-400">{scanError}</p>}
        <div className="divide-y divide-[#0f0f20]">
          {openPorts.length === 0
            ? (
              <div className="px-6 py-8 text-center">
                {scanning ? (
                  <>
                    <Loader className="w-6 h-6 text-indigo-400 animate-spin mx-auto mb-3" />
                    <p className="text-xs text-slate-400 mb-4">Scanning ports on <span className="font-mono text-indigo-400">{device.ip}</span>…</p>
                    <button onClick={handleCancelScan}
                      className="flex items-center gap-2 mx-auto px-4 py-2 bg-red-900/25 hover:bg-red-900/45 border border-red-500/30 hover:border-red-500/55 text-red-400 hover:text-red-300 rounded-lg text-xs font-medium transition-colors">
                      <X className="w-3.5 h-3.5" />
                      Cancel scan
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-400 mb-3">No port data yet</p>
                    <button onClick={handlePortScan}
                      className="flex items-center gap-2 mx-auto px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-400 hover:text-indigo-300 rounded-lg text-xs font-medium transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Scan ports now
                    </button>
                  </>
                )}
              </div>
            )
            : filteredPorts.sort((a, b) => a.port - b.port).map(p => <PortRow key={`${p.port}/${p.protocol}`} port={p} />)
          }
        </div>
      </div>

    </div>
  )
}

// ── Map node / legend helpers ─────────────────────────────────────────────────
function renderMapNode(d, pos, isGw, selected, onSelect, nr) {
  if (!pos) return null
  const isSel = selected?.ip === d.ip
  const online   = d.status === 'online'
  const filtered  = d.status === 'filtered'
  const openPorts = (d.ports ?? []).filter(p => p.state === 'open').length
  const label = d.hostname
    ? (d.hostname.length > 13 ? d.hostname.slice(0, 13) + '…' : d.hostname)
    : d.ip
  return (
    <g key={d.ip} onClick={() => onSelect(d)} style={{ cursor: 'pointer' }}>
      {(isSel || (online && isGw)) && (
        <circle cx={pos.x} cy={pos.y} r={nr + 9}
          fill="none" stroke={isSel ? '#4f46e5' : '#10b981'} strokeWidth="1" opacity="0.25"
        />
      )}
      <circle cx={pos.x} cy={pos.y} r={nr}
        fill={isSel ? '#1e1b4b' : isGw ? '#0c1120' : '#0a0a18'}
        stroke={isSel ? '#6366f1' : online ? '#10b981' : '#1e293b'}
        strokeWidth={isSel ? 2.5 : 1.5}
      />
      <circle cx={pos.x + nr - 7} cy={pos.y - nr + 7} r={isGw ? 7 : 5.5}
        fill={online ? '#10b981' : filtered ? '#f97316' : '#334155'} stroke="#06060f" strokeWidth="1.5"
      />
      {isGw && (
        <text x={pos.x} y={pos.y + 5} textAnchor="middle"
          fill="#818cf8" fontSize="11" fontWeight="bold" fontFamily="monospace"
        >GW</text>
      )}
      {!isGw && online && d.latency != null && (
        <text x={pos.x} y={pos.y + 4} textAnchor="middle"
          fill={isSel ? '#a5b4fc' : '#475569'} fontSize="9" fontFamily="monospace"
        >{d.latency}ms</text>
      )}
      <text x={pos.x} y={pos.y + nr + 17} textAnchor="middle"
        fill={(online || filtered) ? (isSel ? '#e2e8f0' : '#94a3b8') : '#475569'}
        fontSize={isGw ? 12 : 11} fontWeight={isSel ? 'bold' : 'normal'}
      >{label}</text>
      {d.hostname && (
        <text x={pos.x} y={pos.y + nr + 29} textAnchor="middle"
          fill="#2d3a4a" fontSize="9" fontFamily="monospace"
        >{d.ip}</text>
      )}
      {openPorts > 0 && (
        <text x={pos.x} y={pos.y + nr + (d.hostname ? 41 : 29)} textAnchor="middle"
          fill={isSel ? '#6366f1' : '#374151'} fontSize="9"
        >{openPorts} port{openPorts !== 1 ? 's' : ''}</text>
      )}
    </g>
  )
}

function MapLegend() {
  return (
    <g>
      <circle cx="28" cy="28" r="7" fill="none" stroke="#10b981" strokeWidth="1.5" />
      <circle cx="35" cy="21" r="5" fill="#10b981" stroke="#06060f" strokeWidth="1" />
      <text x="46" y="32" fill="#475569" fontSize="11">Online</text>
      <circle cx="28" cy="52" r="7" fill="none" stroke="#1e293b" strokeWidth="1.5" />
      <circle cx="35" cy="45" r="5" fill="#334155" stroke="#06060f" strokeWidth="1" />
      <text x="46" y="56" fill="#475569" fontSize="11">Offline</text>
    </g>
  )
}

// ── Network Map ───────────────────────────────────────────────────────────────
function NetworkMap({ devices, gateway, gatewayAssignments = {}, selected, onSelect }) {
  const [statusFilter, setStatusFilter] = useState('all')
  const W = 1000
  const ROW_START_Y = 240
  const ROW_H = 160
  const GW_R = 36
  const DEV_R = 26

  // Always keep gateway devices visible regardless of status filter
  const gwIpSet = new Set([...(gateway ?? []), ...Object.keys(gatewayAssignments)])
  const displayDevices = statusFilter === 'all' ? devices :
    devices.filter(d => gwIpSet.has(d.ip) ||
      (statusFilter === 'online'  ? (d.status === 'online' || d.status === 'filtered') :
       statusFilter === 'offline' ? d.status === 'offline' : true))

  const onlineCnt  = devices.filter(d => d.status === 'online' || d.status === 'filtered').length
  const offlineCnt = devices.filter(d => d.status === 'offline').length
  const filterBar  = (
    <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#07070e] border-b border-[#0d1117] flex-shrink-0">
      <span className="text-[11px] text-slate-600 mr-1">Show</span>
      {[
        { id: 'all',     label: `All · ${devices.length}` },
        { id: 'online',  label: `Online · ${onlineCnt}` },
        { id: 'offline', label: `Offline · ${offlineCnt}` },
      ].map(f => (
        <button key={f.id} onClick={() => setStatusFilter(f.id)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            statusFilter === f.id ? 'bg-indigo-600 text-white' : 'bg-[#0f0f20] border border-[#1a1a30] text-slate-500 hover:text-slate-300'
          }`}>
          {f.label}
        </button>
      ))}
    </div>
  )

  const hasAssignments = Object.keys(gatewayAssignments).length > 0

  // ── Single-gateway layout ──────────────────────────────────────────────────
  if (!hasAssignments) {
    const ROW_COUNT = 5
    const NODE_SPACING = 175
    const gwIps = gateway ?? []
    const gw =
      (gwIps.length > 0 ? devices.find(d => gwIps.includes(d.ip)) : null) ??
      devices.find(d => d.ip.endsWith('.1')) ??
      devices.find(d => d.ip.endsWith('.254')) ??
      [...devices].sort((a, b) =>
        (b.ports?.filter(p => p.state === 'open').length ?? 0) -
        (a.ports?.filter(p => p.state === 'open').length ?? 0)
      )[0]
    const others = displayDevices.filter(d => d.ip !== gw?.ip)
    const rowCount = Math.ceil(others.length / ROW_COUNT)
    const svgH = Math.max(500, ROW_START_Y + rowCount * ROW_H + 80)
    const positions = {}
    if (gw) positions[gw.ip] = { x: W / 2, y: 80 }
    others.forEach((d, i) => {
      const row = Math.floor(i / ROW_COUNT)
      const rowItems = others.slice(row * ROW_COUNT, (row + 1) * ROW_COUNT)
      const col = i % ROW_COUNT
      const totalW = (rowItems.length - 1) * NODE_SPACING
      positions[d.ip] = { x: W / 2 - totalW / 2 + col * NODE_SPACING, y: ROW_START_Y + row * ROW_H }
    })
    const r = (ip) => (ip === gw?.ip ? GW_R : DEV_R)

    return (
      <div className="flex flex-col w-full h-full">
        {filterBar}
        <div className="flex-1 overflow-auto bg-[#06060f]">
          <svg viewBox={`0 0 ${W} ${svgH}`} className="w-full" style={{ minHeight: 400 }}>
            {gw && others.map(d => {
              const from = positions[gw.ip]; const to = positions[d.ip]
              if (!from || !to) return null
              const isOnline   = d.status === 'online'
              const isFiltered = d.status === 'filtered'
              return (
                <line key={`l-${d.ip}`}
                  x1={from.x} y1={from.y + r(gw.ip)} x2={to.x} y2={to.y - r(d.ip)}
                  stroke={isOnline ? '#1e4060' : isFiltered ? '#7c3a10' : '#111827'}
                  strokeWidth={(isOnline || isFiltered) ? 1.5 : 1}
                  strokeDasharray={isFiltered ? '6 3' : isOnline ? undefined : '5 5'}
                />
              )
            })}
            {displayDevices.map(d => renderMapNode(d, positions[d.ip], d.ip === gw?.ip, selected, onSelect, r(d.ip)))}
            <MapLegend />
            {(gateway ?? []).length > 1 && (
              <text x={W / 2} y={svgH - 12} textAnchor="middle" fill="#1e3a4a" fontSize="10">
                {(gateway ?? []).join(' · ')} detected — add gateway_assignments in Settings to group devices by gateway
              </text>
            )}
          </svg>
        </div>
      </div>
    )
  }

  // ── Multi-gateway layout ────────────────────────────────────────────────────
  const gwIps = Object.keys(gatewayAssignments)
  const N = gwIps.length
  const colW = W / N
  const ITEMS_PER_ROW = Math.max(2, Math.floor(colW / 160))

  // Gateway device objects — synthetic placeholder if not in scan results
  const gwDeviceMap = new Map(gwIps.map(ip => [
    ip,
    devices.find(d => d.ip === ip) ?? { ip, hostname: null, status: 'offline', ports: [], latency: null },
  ]))

  // Assigned devices per gateway column (excluding the gateway IPs themselves)
  const colDevicesMap = new Map(gwIps.map(gwIp => [
    gwIp,
    (gatewayAssignments[gwIp] ?? [])
      .map(ip => displayDevices.find(d => d.ip === ip))
      .filter(Boolean)
      .filter(d => !gwIps.includes(d.ip)),
  ]))

  // Unassigned: not a gateway and not in any assignment list
  const allKnown = new Set([...gwIps, ...Object.values(gatewayAssignments).flat()])
  const unassigned = displayDevices.filter(d => !allKnown.has(d.ip))

  // Position calculation
  const positions = {}
  gwIps.forEach((gwIp, i) => { positions[gwIp] = { x: colW * i + colW / 2, y: 80 } })

  let maxRowCount = 0
  gwIps.forEach((gwIp, i) => {
    const devs = colDevicesMap.get(gwIp) ?? []
    devs.forEach((d, j) => {
      const row = Math.floor(j / ITEMS_PER_ROW)
      const rowDevs = devs.slice(row * ITEMS_PER_ROW, (row + 1) * ITEMS_PER_ROW)
      const col = j % ITEMS_PER_ROW
      const spacing = colW / (ITEMS_PER_ROW + 1)
      const totalW = (rowDevs.length - 1) * spacing
      positions[d.ip] = { x: colW * i + colW / 2 - totalW / 2 + col * spacing, y: ROW_START_Y + row * ROW_H }
      maxRowCount = Math.max(maxRowCount, row + 1)
    })
  })

  const UNASSIGNED_Y = ROW_START_Y + maxRowCount * ROW_H + (maxRowCount > 0 ? 50 : 0)
  unassigned.forEach((d, i) => {
    const spacing = Math.min(175, W / (unassigned.length + 1))
    positions[d.ip] = { x: W / 2 - ((unassigned.length - 1) * spacing) / 2 + i * spacing, y: UNASSIGNED_Y }
  })

  const svgH = Math.max(500, (unassigned.length > 0 ? UNASSIGNED_Y : ROW_START_Y + maxRowCount * ROW_H) + 120)

  const allNodes = new Map()
  for (const [ip, d] of gwDeviceMap) allNodes.set(ip, d)
  for (const devs of colDevicesMap.values()) for (const d of devs) allNodes.set(d.ip, d)
  for (const d of unassigned) allNodes.set(d.ip, d)

  return (
    <div className="flex flex-col w-full h-full">
      {filterBar}
      <div className="flex-1 overflow-auto bg-[#06060f]">
      <svg viewBox={`0 0 ${W} ${svgH}`} className="w-full" style={{ minHeight: 400 }}>

        {/* Column dividers */}
        {gwIps.slice(0, -1).map((_, i) => (
          <line key={`sep-${i}`}
            x1={colW * (i + 1)} y1={40} x2={colW * (i + 1)} y2={svgH - 30}
            stroke="#0d1117" strokeWidth="1.5"
          />
        ))}

        {/* Gateway → assigned device lines */}
        {gwIps.map(gwIp => {
          const from = positions[gwIp]
          if (!from) return null
          return (colDevicesMap.get(gwIp) ?? []).map(d => {
            const to = positions[d.ip]
            if (!to) return null
            const online = d.status === 'online'
            return (
              <line key={`l-${gwIp}-${d.ip}`}
                x1={from.x} y1={from.y + GW_R} x2={to.x} y2={to.y - DEV_R}
                stroke={online ? '#1e3040' : '#111827'}
                strokeWidth={online ? 1.5 : 1} strokeDasharray={online ? undefined : '5 5'}
              />
            )
          })
        })}

        {/* Unassigned → nearest gateway (dashed) */}
        {unassigned.map(d => {
          const to = positions[d.ip]
          if (!to) return null
          const nearestGw = gwIps.reduce((best, gwIp) => {
            const gp = positions[gwIp]
            if (!gp) return best
            const dist = Math.abs(gp.x - to.x)
            return (!best || dist < best.dist) ? { gwIp, dist } : best
          }, null)
          if (!nearestGw) return null
          const from = positions[nearestGw.gwIp]
          if (!from) return null
          return (
            <line key={`u-${d.ip}`}
              x1={from.x} y1={from.y + GW_R} x2={to.x} y2={to.y - DEV_R}
              stroke="#1e293b" strokeWidth="1" strokeDasharray="4 6"
            />
          )
        })}

        {/* All nodes */}
        {[...allNodes.values()].map(d => {
          const isGw = gwIps.includes(d.ip)
          return renderMapNode(d, positions[d.ip], isGw, selected, onSelect, isGw ? GW_R : DEV_R)
        })}

        {unassigned.length > 0 && (
          <text x={W / 2} y={UNASSIGNED_Y - 20} textAnchor="middle" fill="#334155" fontSize="11">
            unassigned
          </text>
        )}

        <MapLegend />
      </svg>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyDetail() {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-10">
      <div>
        <Network className="w-10 h-10 text-indigo-400/20 mx-auto mb-3" />
        <p className="text-slate-400 text-sm font-medium">Select a device</p>
        <p className="text-slate-400 text-xs mt-1">Click any device in the tree to see its details</p>
      </div>
    </div>
  )
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <p className="text-sm text-slate-300 mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-xs bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300 rounded-lg transition-colors"
          >
            Yes, proceed
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NetworkScan({ networkScan, threats, services, onScan, onCancel, preSelectedIp, onDeviceUpdated, onClearAll, portScanProgress = {}, deepScan = {}, lastScanDurationMs = null, lastDeepScanDurationMs = null }) {
  const { devices = [], lastScan, scanning, error, progress, subnets = [], devicesFound = 0, gateway = null, gatewayAssignments = {} } = networkScan
  const { running: deepRunning = false, done: deepDone = 0, total: deepTotal = 0, currentIp: deepCurrentIp = null, phase: deepPhase = 'portscan' } = deepScan

  function fmtDur(ms) {
    if (ms == null) return null
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
  }
  const [selected, setSelected] = useState(null)
  const [mapView, setMapView] = useState(false)
  const [confirm, setConfirm] = useState(null) // { message, onConfirm }
  const [configSubnets, setConfigSubnets] = useState([])
  const [myIp, setMyIp] = useState(null)

  // Use WebRTC ICE candidates to discover the browser's actual LAN IP(s).
  // Check for manual override first
  useEffect(() => {
    const override = localStorage.getItem('claudette:my-ip')
    if (override) setMyIp([override])
  }, [])

  // This works correctly even when cross-subnet NAT is involved (e.g. TP-Link
  // Deco mesh where the server would otherwise see the Deco's IP, not the
  // client's real 192.168.68.x address).
  useEffect(() => {
    if (localStorage.getItem('claudette:my-ip')) return  // manual override takes precedence
    if (localStorage.getItem('claudette:my-device')) return  // manual device mark takes precedence
    let cancelled = false
    let timeoutId
    try {
      const pc = new RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('')
      const ips = new Set()
      pc.onicecandidate = e => {
        if (!e || !e.candidate) return
        const m = e.candidate.candidate.match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})/)
        const ip = m?.[1]
        // Exclude loopback, link-local, and gateway-convention addresses (.1, .254)
        // which are almost always routers, never end-user machines
        if (ip &&
            !ip.startsWith('127.') &&
            !ip.startsWith('169.254.') &&
            !ip.endsWith('.1') &&
            !ip.endsWith('.254')) ips.add(ip)
      }
      const finish = () => {
        clearTimeout(timeoutId)
        try { pc.close() } catch { /* ignore */ }
        if (!cancelled && ips.size > 0) setMyIp([...ips])
      }
      // Prefer waiting for ICE gathering to complete rather than a fixed cutoff —
      // on some machines/browsers gathering 192.168.68.x takes longer than 2 s.
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') finish()
      }
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {})
      // Hard cap: 4 s in case onicegatheringstatechange never fires
      timeoutId = setTimeout(finish, 4000)
    } catch { /* WebRTC unavailable */ }
    return () => { cancelled = true; clearTimeout(timeoutId) }
  }, [])

  // Identify the user's own device IP from the server's view of the HTTP connection.
  // Only used as a fallback when WebRTC yielded no results — on cross-subnet setups
  // (e.g. TP-Link Deco mesh) the server sees the gateway IP, not the real device IP.
  useEffect(() => {
    if (localStorage.getItem('claudette:my-ip')) return  // manual override takes precedence
    if (localStorage.getItem('claudette:my-device')) return  // manual device mark takes precedence
    api.network.myIp().then(r => {
      if (r.ip) setMyIp(prev => {
        // If WebRTC already found at least one IP, trust that over the server's view
        if (Array.isArray(prev) && prev.length > 0) return prev
        return [r.ip]
      })
    }).catch(() => {})
  }, [])

  // Load configured subnets so filter tabs appear before first scan
  useEffect(() => {
    api.config.get().then(cfg => {
      const s = cfg?.network?.subnets ?? (cfg?.network?.subnet ? [cfg.network.subnet] : [])
      setConfigSubnets(s)
    }).catch(() => {})
  }, [])

  // Use scan-time subnets when available (most accurate), fall back to config
  const effectiveSubnets = subnets.length > 0 ? subnets : configSubnets

  // Precompute threat severity per device IP
  const threatMap = useMemo(() => {
    const allThreats = threats?.threats ?? []
    const serviceResults = services?.results ?? []
    if (!allThreats.length) return {}
    return Object.fromEntries(
      devices
        .map(d => [d.ip, deviceThreatLevel(d.ip, allThreats, devices, serviceResults)])
        .filter(([, sev]) => sev != null)
    )
  }, [threats, services, devices])

  // Auto-select when preSelectedIp changes (sidebar click) or devices load
  useEffect(() => {
    if (preSelectedIp && devices.length > 0) {
      const match = devices.find(d => d.ip === preSelectedIp)
      if (match) { setSelected(match); return }
    }
    // Auto-select first device when none is selected
    if (!selected && devices.length > 0) setSelected(devices[0])
  }, [preSelectedIp, devices])

  // Keep selected in sync if devices refresh
  const selectedDevice = selected ? (devices.find(d => d.ip === selected.ip) ?? selected) : null

  return (
    <div className="flex flex-col h-full">
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a30] flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Network</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            {devices.length > 0
              ? (() => {
                  const lps = devices.reduce((m, d) => (d.updatedAt && (d.ports?.length ?? 0) > 0 ? Math.max(m, d.updatedAt) : m), 0)
                  return [
                    `${devices.length} device${devices.length !== 1 ? 's' : ''}`,
                    lastScan ? `scanned ${relTime(lastScan)}`  : null,
                    lps > 0  ? `ports ${relTime(lps)}`         : null,
                  ].filter(Boolean).join(' · ')
                })()
              : 'Subnet device discovery'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* List / Map view toggle */}
          <div className="flex items-center bg-[#0f0f20] border border-[#1a1a30] rounded-lg p-0.5">
            <button
              onClick={() => setMapView(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!mapView ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              List
            </button>
            <button
              onClick={() => setMapView(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mapView ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Map className="w-3.5 h-3.5" />
              Map
            </button>
          </div>
          {scanning && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-red-400 border border-[#1a1a30] hover:border-red-500/30 rounded-lg text-xs transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              {error.includes('nmap') ? 'nmap not found' : 'Scan failed'}
            </div>
          )}
          <button
            onClick={() => setConfirm({
              message: `This will ping-sweep your network and update device statuses.${fmtDur(lastScanDurationMs) ? ` Last run took ${fmtDur(lastScanDurationMs)}.` : ' First run.'} Continue?`,
              onConfirm: () => { setConfirm(null); onScan() },
            })}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Wifi className={`w-4 h-4 ${scanning ? 'animate-pulse' : ''}`} />
            {scanning ? 'Scanning…' : devices.length > 0 ? 'Re-scan' : 'Scan Network'}
          </button>
          {!scanning && (
            <button
              onClick={() => setConfirm({
                message: `Deep scan port-scans every device one by one — this can take several minutes.${fmtDur(lastDeepScanDurationMs) ? ` Last run took ${fmtDur(lastDeepScanDurationMs)}.` : ' No previous run recorded.'} Continue?`,
                onConfirm: () => { setConfirm(null); api.network.deepScan().catch(console.error) },
              })}
              disabled={deepRunning || devices.length === 0}
              title="Full port scan of all online devices — takes a while"
              className="flex items-center gap-1.5 px-3 py-2 border border-indigo-500/25 hover:border-indigo-500/50 text-indigo-400 hover:text-indigo-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deepRunning
                ? <><span className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin" /> Scanning…</>
                : <><Search className="w-3.5 h-3.5" /> Deep Scan</>}
            </button>
          )}
          {!scanning && (
            <button
              onClick={() => devices.length > 0 && setConfirm({
                message: `Are you sure you want to remove all ${devices.length} device${devices.length !== 1 ? 's' : ''} from the database?`,
                onConfirm: () => { setConfirm(null); onClearAll() },
              })}
              disabled={devices.length === 0}
              title={devices.length > 0 ? 'Remove all devices' : 'No devices to clear'}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-900/20 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 text-red-500 hover:text-red-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-900/20 disabled:hover:border-red-500/20 disabled:hover:text-red-500"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Regular scan progress */}
      {scanning && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-[#1a1a30] bg-[#080812]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-400">
              {subnets.length > 0
                ? <>Pinging <span className="font-mono text-indigo-400">{subnets.join(', ')}</span>{devicesFound > 0 && <span className="text-slate-500"> · {devicesFound} found</span>}</>
                : 'Discovering devices…'}
            </span>
            {progress != null && (
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">{Math.round(progress)}%</span>
            )}
          </div>
          <div className="h-1.5 bg-[#1a1a30] rounded-full overflow-hidden">
            {progress != null
              ? <div className="h-full bg-indigo-500 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
              : <div className="h-full bg-indigo-500/60 rounded-full animate-pulse w-full" />}
          </div>
        </div>
      )}

      {/* Deep scan progress */}
      {deepRunning && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-[#1a1a30] bg-[#080812]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-400">
              {deepPhase === 'ping'
                ? 'Deep scan · pinging network…'
                : <>Deep scan{deepCurrentIp && <> · <span className="font-mono text-indigo-400">{deepCurrentIp}</span></>}
                    {deepTotal > 0 && <span className="text-slate-500"> ({deepDone}/{deepTotal} devices)</span>}
                  </>}
            </span>
            <div className="flex items-center gap-3">
              {deepPhase !== 'ping' && deepTotal > 0 && (
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">{Math.round((deepDone / deepTotal) * 100)}%</span>
              )}
              <button onClick={() => api.network.cancelDeepScan().catch(console.error)} className="text-[11px] text-slate-600 hover:text-red-400 transition-colors">
                Cancel
              </button>
            </div>
          </div>
          <div className="h-1.5 bg-[#1a1a30] rounded-full overflow-hidden">
            {deepPhase !== 'ping' && deepTotal > 0
              ? <div className="h-full bg-violet-500 rounded-full transition-all duration-300" style={{ width: `${Math.round((deepDone / deepTotal) * 100)}%` }} />
              : <div className="h-full bg-violet-500/60 rounded-full animate-pulse w-full" />}
          </div>
        </div>
      )}

      {/* Body: map OR tree + detail */}
      {mapView && devices.length > 0 ? (
        <div className="flex-1 overflow-hidden">
          <NetworkMap
            devices={devices}
            gateway={gateway}
            gatewayAssignments={gatewayAssignments}
            selected={selectedDevice}
            onSelect={d => { setSelected(d); setMapView(false) }}
          />
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Left tree */}
        <div className="w-56 flex-shrink-0">
          {devices.length === 0 && !scanning ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Network className="w-8 h-8 text-indigo-400/20 mb-3" />
              <p className="text-xs text-slate-500">Run a scan to discover devices</p>
              {error?.includes('nmap') && (
                <p className="text-[10px] text-red-700 mt-2">Requires nmap:<br /><code className="font-mono">sudo apt install nmap</code></p>
              )}
            </div>
          ) : (
            <DeviceTree
              devices={devices}
              selected={selectedDevice}
              onSelect={setSelected}
              scanning={scanning}
              portScanProgress={portScanProgress}
              subnets={effectiveSubnets}
              threatMap={threatMap}
              myIp={myIp}
            />
          )}
        </div>

        {/* Right detail */}
        <div className="flex-1 overflow-hidden border-l border-[#1a1a30]">
          {selectedDevice
            ? <DeviceDetail key={selectedDevice.ip} device={selectedDevice} knownDevices={devices} onDeviceUpdated={onDeviceUpdated} portScanProgress={portScanProgress} />
            : <EmptyDetail />
          }
        </div>
      </div>
      )}
    </div>
  )
}
