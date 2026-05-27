import { useState, useEffect, useCallback } from 'react'
import Layout from './components/Layout.jsx'
import Dashboard from './components/Dashboard.jsx'
import ServicesPanel from './components/ServicesPanel.jsx'
import ThreatsPanel from './components/ThreatsPanel.jsx'
import NetworkScan from './components/NetworkScan.jsx'
import SystemStats from './components/SystemStats.jsx'
import WizardModal from './components/WizardModal.jsx'
import AuthModal from './components/AuthModal.jsx'
import AuditLog from './components/AuditLog.jsx'
import Settings from './components/Settings.jsx'
import AboutPage from './components/AboutPage.jsx'
import Reports from './components/Reports.jsx'
import TopProgressBar from './components/TopProgressBar.jsx'
import { createEventSource, api } from './lib/api.js'
import { applyTheme } from './lib/themes.js'

// Apply stored theme immediately — before any React render — to avoid flash
;(function () {
  const t = localStorage.getItem('claudette:theme')
  if (t) applyTheme(t)
})()

function ToastStack({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl border pointer-events-auto ${
          t.type === 'online'  ? 'bg-emerald-900/95 border-emerald-600/40 text-emerald-200' :
          t.type === 'offline' ? 'bg-slate-800/95  border-slate-600/40  text-slate-300'    :
          t.type === 'new'     ? 'bg-indigo-900/95 border-indigo-500/40 text-indigo-200'   :
                                 'bg-[#0f0f20]/95  border-[#1a1a30]     text-slate-300'
        }`}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            t.type === 'online'  ? 'bg-emerald-400' :
            t.type === 'offline' ? 'bg-slate-500'   :
            t.type === 'new'     ? 'bg-indigo-400'  : 'bg-slate-400'
          }`} />
          {t.msg}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('network')
  const [services, setServices] = useState({ results: [], history: {} })
  const [threats, setThreats] = useState({ threats: [], lastRefresh: null })
  const [networkScan, setNetworkScan] = useState({ devices: [], lastScan: null, scanning: false, error: null, progress: null, subnets: [], devicesFound: 0, gateway: null, gatewayAssignments: {} })
  const [portScanProgress, setPortScanProgress] = useState({}) // { [ip]: percent | null }
  const [systemStats, setSystemStats] = useState(null)
  const [selectedDeviceIp, setSelectedDeviceIp] = useState(null)
  const [showWizard, setShowWizard] = useState(false)
  const [configStatus, setConfigStatus] = useState({ exists: false, valid: false, outdated: false })
  const [dbErrors, setDbErrors] = useState([])

  const [deepScan, setDeepScan] = useState({ running: false, done: 0, total: 0, currentIp: null })
  const [lastScanDurationMs,      setLastScanDurationMs]      = useState(() => { const v = localStorage.getItem('claudette:lastScanMs'); return v ? Number(v) : null })
  const [lastDeepScanDurationMs,  setLastDeepScanDurationMs]  = useState(() => { const v = localStorage.getItem('claudette:lastDeepScanMs'); return v ? Number(v) : null })

  const [toasts, setToasts] = useState([])
  const addToast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev.slice(-4), { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  // ── Auth state ────────────────────────────────────────────────────────────
  const [auth, setAuth] = useState({ checking: true, registered: false, authenticated: false, username: null })

  // Check auth first — everything else waits until this resolves
  useEffect(() => {
    api.auth.status()
      .then(s => setAuth({ checking: false, ...s }))
      .catch(() => setAuth({ checking: false, registered: false, authenticated: false, username: null }))
  }, [])

  // Listen for 401s from any API call (session expired mid-session)
  useEffect(() => {
    const handler = () => setAuth(a => ({ ...a, authenticated: false }))
    window.addEventListener('claudette:session-expired', handler)
    return () => window.removeEventListener('claudette:session-expired', handler)
  }, [])

  const handleAuthenticated = (username) => {
    setAuth({ checking: false, registered: true, authenticated: true, username })
  }

  const handleLogout = useCallback(async () => {
    await api.auth.logout().catch(() => {})
    setAuth(a => ({ ...a, authenticated: false }))
  }, [])

  // Show wizard if config is missing or doesn't have required fields — only when authenticated
  useEffect(() => {
    if (!auth.authenticated) return
    api.config.status()
      .then((s) => {
        setConfigStatus(s)
        if (!s.exists || !s.valid || s.outdated) setShowWizard(true)
      })
      .catch(() => {}) // server may not be ready yet — ignore
  }, [auth.authenticated])

  // Initial data load — read from DB, no auto-scan
  useEffect(() => {
    if (!auth.authenticated) return
    api.services.get().then(setServices).catch(console.error)
    api.threats.get().then(setThreats).catch(console.error)
    api.network.get().then(d => setNetworkScan(prev => ({ ...prev, ...d }))).catch(console.error)
    api.system.stats().then(setSystemStats).catch(console.error)
    api.config.get().then(cfg => {
      // Use localStorage override if present (persists even when server save fails)
      const localTheme = localStorage.getItem('claudette:theme')
      const serverTheme = cfg?.ui?.theme
      // Trust localStorage if set; otherwise fall back to server config and persist it
      if (localTheme) {
        applyTheme(localTheme)
      } else if (serverTheme) {
        applyTheme(serverTheme)
        localStorage.setItem('claudette:theme', serverTheme)
      }
    }).catch(() => {})
  }, [auth.authenticated])

  // System stats poll every 5s
  useEffect(() => {
    if (!auth.authenticated) return
    const id = setInterval(() => {
      api.system.stats().then(setSystemStats).catch(console.error)
    }, 5000)
    return () => clearInterval(id)
  }, [auth.authenticated])

  // SSE real-time updates
  useEffect(() => {
    if (!auth.authenticated) return
    const es = createEventSource((type, data) => {
      if (type === 'services') {
        setServices(prev => ({ ...prev, results: data.results }))
        api.services.history()
          .then(h => setServices(prev => ({ ...prev, history: h })))
          .catch(() => {})
      }
      if (type === 'threats') {
        setThreats(prev => ({
          threats: [...data.threats, ...prev.threats].slice(0, 200),
          lastRefresh: Date.now(),
        }))
      }
      if (type === 'scan_started') {
        setNetworkScan(prev => ({ ...prev, scanning: true, error: null, progress: 0, devicesFound: 0, subnets: data.subnets ?? prev.subnets }))
      }
      if (type === 'scan_progress') {
        setNetworkScan(prev => ({ ...prev, progress: data.percent, devicesFound: data.devicesFound ?? prev.devicesFound }))
      }
      if (type === 'scan_complete') {
        setNetworkScan(prev => {
          // Upsert: update/add devices from scan, keep any existing devices not in the new payload.
          // Preserve port/script/os data from previous port scans when the new ping-sweep has none.
          const newMap = Object.fromEntries(data.devices.map(d => [d.ip, d]))
          const merged = prev.devices.map(d => {
            const fresh = newMap[d.ip]
            if (!fresh) return d
            return {
              ...fresh,
              ports:       fresh.ports?.length       ? fresh.ports       : d.ports,
              hostScripts: fresh.hostScripts?.length ? fresh.hostScripts : d.hostScripts,
              traceroute:  fresh.traceroute?.length  ? fresh.traceroute  : d.traceroute,
              os:          fresh.os       ?? d.os,
              vendor:      fresh.vendor   ?? d.vendor,
              hostname:    fresh.hostname ?? d.hostname,
              label:       fresh.label    ?? d.label,
            }
          })
          const existingIps = new Set(prev.devices.map(d => d.ip))
          const added = data.devices.filter(d => !existingIps.has(d.ip))
          return { ...prev, devices: [...merged, ...added], lastScan: data.ts, scanning: false, error: null, progress: 100, gateway: data.gateway ?? prev.gateway, gatewayAssignments: data.gatewayAssignments ?? prev.gatewayAssignments }
        })
        if (data.durationMs != null) { setLastScanDurationMs(data.durationMs); localStorage.setItem('claudette:lastScanMs', data.durationMs) }
      }
      if (type === 'ping_complete') {
        setNetworkScan(prev => {
          const statusMap = Object.fromEntries(data.results.map(r => [r.ip, r]))
          const updated = prev.devices.map(d => {
            const hit = statusMap[d.ip]
            if (!hit) return d
            if (hit.status !== d.status) {
              const name = d.label || d.hostname || d.ip
              if (hit.status === 'online' || hit.status === 'filtered') addToast(`${name} is back online`, 'online')
              else addToast(`${name} went offline`, 'offline')
            }
            return { ...d, status: hit.status, latency: hit.latency ?? d.latency, detectedGateway: hit.detectedGateway ?? d.detectedGateway }
          })
          // Append any brand-new devices discovered by the sweep
          const existingIps = new Set(prev.devices.map(d => d.ip))
          const added = (data.newDevices ?? []).filter(d => !existingIps.has(d.ip))
          added.forEach(d => addToast(`New device: ${d.label || d.hostname || d.ip}`, 'new'))
          return { ...prev, devices: [...updated, ...added] }
        })
      }
      if (type === 'scan_error') {
        setNetworkScan(prev => ({ ...prev, scanning: false, error: data.error, progress: null }))
      }
      if (type === 'port_scan_progress') {
        setPortScanProgress(prev => ({ ...prev, [data.ip]: data.percent ?? null }))
      }
      if (type === 'deep_scan_started') {
        setDeepScan({ running: true, done: 0, total: 0, currentIp: null, phase: data.phase ?? 'ping' })
      }
      if (type === 'deep_scan_progress') {
        setDeepScan({ running: true, done: data.done ?? 0, total: data.total ?? 0, currentIp: data.ip ?? null, phase: data.phase ?? 'portscan' })
      }
      if (type === 'deep_scan_complete') {
        setDeepScan({ running: false, done: 0, total: 0, currentIp: null })
        if (data.durationMs != null) { setLastDeepScanDurationMs(data.durationMs); localStorage.setItem('claudette:lastDeepScanMs', data.durationMs) }
      }
      if (type === 'device_error') {
        console.error('[device_error]', data)
        setDbErrors(prev => [...prev, data])
      }
    })
    return () => es.close()
  }, [auth.authenticated])

  // Hourglass cursor site-wide while scanning
  useEffect(() => {
    document.body.style.cursor = networkScan.scanning ? 'wait' : ''
    return () => { document.body.style.cursor = '' }
  }, [networkScan.scanning])

  const handleScan = useCallback(() => {
    setNetworkScan(prev => ({ ...prev, scanning: true, error: null }))
    api.network.scan().catch(err => {
      setNetworkScan(prev => ({ ...prev, scanning: false, error: err.message }))
    })
  }, [])

  const handleCancel = useCallback(() => {
    api.network.cancel().catch(console.error)
    setNetworkScan(prev => ({ ...prev, scanning: false, error: null }))
  }, [])

  const handleRefreshThreats = useCallback(() =>
    api.threats.refresh().then(setThreats), [])

  const handleRefreshServices = useCallback(() =>
    api.services.get().then(setServices), [])

  const handleSelectDevice = useCallback((ip) => {
    setSelectedDeviceIp(ip)
    setPage('network')
  }, [])

  // Called by DeviceDetail after a per-device port scan completes
  const handleDeviceUpdated = useCallback((updated) => {
    setNetworkScan(prev => ({
      ...prev,
      devices: prev.devices.map(d => d.ip === updated.ip ? { ...d, ...updated } : d),
    }))
  }, [])

  const handleClearAll = useCallback(() => {
    api.network.clearAll().then(() => {
      setNetworkScan(prev => ({ ...prev, devices: [], lastScan: null }))
    }).catch(console.error)
  }, [])

  const pages = {
    dashboard: Dashboard,
    services: ServicesPanel,
    threats: ThreatsPanel,
    network: NetworkScan,
    system: SystemStats,
    audit: AuditLog,
    reports: Reports,
    settings: Settings,
    about: AboutPage,
  }
  const Page = pages[page] || Dashboard

  return (
    <>
      {/* ── Auth gate — nothing renders until authenticated ── */}
      {auth.checking && (
        <div className="fixed inset-0 bg-[#080812] flex items-center justify-center">
          <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!auth.checking && !auth.authenticated && auth.registered && (
        <AuthModal onAuthenticated={handleAuthenticated} />
      )}

      {!auth.checking && !auth.authenticated && !auth.registered && (
        <WizardModal
          needsAccount
          configExists={false}
          configValid={false}
          configOutdated={false}
          onRegistered={handleAuthenticated}
          onComplete={() => { setShowWizard(false); setConfigStatus({ exists: true, valid: true, outdated: false }) }}
          onSkip={() => {}}
        />
      )}

      {/* ── Main app — only rendered when authenticated ── */}
      {!auth.checking && auth.authenticated && (
        <>
      <TopProgressBar active={networkScan.scanning} progress={networkScan.progress} />
      {showWizard && (
        <WizardModal
          configExists={configStatus.exists}
          configValid={configStatus.valid}
          configOutdated={configStatus.outdated}
          onComplete={() => { setShowWizard(false); setConfigStatus({ exists: true, valid: true, outdated: false }) }}
          onSkip={() => setShowWizard(false)}
        />
      )}
      <Layout
        page={page}
        setPage={setPage}
        services={services}
        threats={threats}
        onShowWizard={() => setShowWizard(true)}
        username={auth.username}
        onLogout={handleLogout}
      >
        <Page
          services={services}
          threats={threats}
          networkScan={networkScan}
          systemStats={systemStats}
          onScan={handleScan}
          onCancel={handleCancel}
          onRefreshThreats={handleRefreshThreats}
          onRefreshServices={handleRefreshServices}
          onOpenWizard={() => setShowWizard(true)}
          onShowWizard={() => setShowWizard(true)}
          onDeviceUpdated={handleDeviceUpdated}
          onClearAll={handleClearAll}
          portScanProgress={portScanProgress}
          deepScan={deepScan}
          lastScanDurationMs={lastScanDurationMs}
          lastDeepScanDurationMs={lastDeepScanDurationMs}
          setPage={setPage}
          preSelectedIp={page === 'network' ? selectedDeviceIp : null}
        />
      </Layout>
      {dbErrors.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0f0f20] border border-red-500/30 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h2 className="text-base font-semibold text-red-400 mb-1">Database Error</h2>
            <p className="text-xs text-slate-500 mb-3">A device could not be saved. This may indicate a MAC address conflict.</p>
            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {dbErrors.map((e, i) => (
                <div key={i} className="text-xs bg-[#080812] rounded-lg p-3 border border-[#1a1a30]">
                  <p className="text-slate-300 font-mono">{e.ip}{e.mac ? ` — ${e.mac}` : ''}</p>
                  <p className="text-red-300 mt-1">{e.error}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setDbErrors([])}
              className="w-full py-2 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <ToastStack toasts={toasts} />
        </>
      )}
    </>
  )
}
