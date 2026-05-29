import { useState, useEffect, useRef } from 'react'
import { Save, Plus, Trash2, Edit2, Check, X, RefreshCw, Wand2, Play, Loader2, Network, Download, Upload } from 'lucide-react'
import { api } from '../lib/api.js'
import { THEMES, applyTheme } from '../lib/themes.js'

// ── Job definitions ───────────────────────────────────────────────────────────
const JOBS = {
  services: {
    label: 'Service Check',
    desc:  'Pings all monitored services and records their HTTP/Docker status.',
    eta:   '~10s',
    trigger: () => api.services.run(),
  },
  internet: {
    label: 'Internet Check',
    desc:  'Checks connectivity to configured hosts (e.g. 1.1.1.1) to verify your connection.',
    eta:   '~5s',
    trigger: () => api.services.runInternet(),
  },
  ping: {
    label: 'Ping Sweep',
    desc:  'Scans the local subnet for active devices using ICMP ping.',
    eta:   '~30–60s',
    trigger: () => api.network.scan(),
  },
  threats: {
    label: 'Threat Refresh',
    desc:  'Fetches the latest CVEs and security advisories from configured RSS feeds.',
    eta:   '~15–30s',
    trigger: () => api.threats.run(),
  },
  speedtest: {
    label: 'Speed Test',
    desc:  'Measures your download/upload speed and ping via Cloudflare infrastructure.',
    eta:   '~35s',
    trigger: () => api.reports.runSpeedtest(),
  },
}

// ── Schedule preset options ──────────────────────────────────────────────────
const MIN_OPTS = [
  { value: 1,  label: 'Every minute' },
  { value: 2,  label: 'Every 2 min' },
  { value: 5,  label: 'Every 5 min' },
  { value: 10, label: 'Every 10 min' },
  { value: 15, label: 'Every 15 min' },
  { value: 30, label: 'Every 30 min' },
  { value: 60, label: 'Every hour (on the dot)' },
]
const HR_OPTS = [
  { value: 1,  label: 'Every hour (on the dot)' },
  { value: 2,  label: 'Every 2 hours' },
  { value: 3,  label: 'Every 3 hours' },
  { value: 4,  label: 'Every 4 hours' },
  { value: 6,  label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Once a day' },
]
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  if (h === 0)  return { value: 0,  label: '12:00 AM (midnight)' }
  if (h < 12)   return { value: h,  label: `${h}:00 AM` }
  if (h === 12) return { value: 12, label: '12:00 PM (noon)' }
  return { value: h, label: `${h - 12}:00 PM` }
})

// ── Toast container ───────────────────────────────────────────────────────────
function ToastContainer({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur-sm ${
          t.type === 'success' ? 'bg-emerald-950/95 border-emerald-500/30 text-emerald-300'
          : t.type === 'error' ? 'bg-red-950/95 border-red-500/30 text-red-300'
          : 'bg-[#0f0f22]/95 border-[#2a2a45] text-slate-300'
        }`}>
          {t.type === 'success' && <Check className="w-4 h-4 flex-shrink-0" />}
          {t.type === 'error'   && <X className="w-4 h-4 flex-shrink-0" />}
          {t.type === 'info'    && <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />}
          {t.message}
        </div>
      ))}
    </div>
  )
}

// ── Run Job Dialog ────────────────────────────────────────────────────────────
function RunJobDialog({ jobId, onClose, onBackground }) {
  const job = JOBS[jobId]
  const [status, setStatus] = useState('running')
  const [msg, setMsg] = useState('')
  const doneRef = useRef(false)

  useEffect(() => {
    if (!job) return
    job.trigger().catch(err => {
      setStatus('error')
      setMsg(err.message)
    })
    const es = new EventSource('/api/events')
    es.addEventListener('job_done', e => {
      const data = JSON.parse(e.data)
      if (data.job === jobId && !doneRef.current) {
        doneRef.current = true
        setStatus('done')
        setMsg(`${job.label} completed.`)
        es.close()
      }
    })
    es.onerror = () => {}
    return () => es.close()
  }, [jobId])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0d0d1e] border border-[#1a1a30] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Play className="w-4 h-4 text-indigo-400" />
              <h2 className="text-base font-semibold text-white">{job?.label}</h2>
              <span className="text-[10px] bg-[#1a1a30] text-slate-400 rounded px-1.5 py-0.5 font-mono">{job?.eta}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{job?.desc}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-[#1a1a30] rounded-full overflow-hidden mb-4">
          {status === 'running' && <div className="h-full w-1/3 bg-indigo-500 rounded-full animate-indeterminate" />}
          {status === 'done'    && <div className="h-full w-full bg-emerald-500 rounded-full transition-all duration-500" />}
          {status === 'error'   && <div className="h-full w-full bg-red-500 rounded-full" />}
        </div>

        {/* Status line */}
        <p className={`text-xs mb-5 flex items-center gap-1.5 ${status === 'done' ? 'text-emerald-400' : status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
          {status === 'running' && <><Loader2 className="w-3 h-3 animate-spin" />Running…</>}
          {status === 'done'    && <><Check className="w-3 h-3" />{msg}</>}
          {status === 'error'   && msg}
        </p>

        <div className="flex items-center gap-2 justify-end">
          {status === 'running' && (
            <button onClick={() => onBackground(jobId)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg transition-colors">
              Run in background
            </button>
          )}
          <button onClick={onClose} disabled={status === 'running'}
            className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              status === 'done'  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-600/30'
              : status === 'error' ? 'bg-red-600/20 text-red-400 border border-red-500/25 hover:bg-red-600/30'
              : 'bg-[#1a1a30] text-slate-500 cursor-not-allowed'
            }`}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Field({ label, hint, ...props }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-400">{label}</label>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      <input {...props} className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors" />
    </div>
  )
}

function SectionHeading({ children }) {
  return <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4 pt-2">{children}</h2>
}

// ── Service row ───────────────────────────────────────────────────────────────
function ServiceRow({ svc, idx, onSave, onDelete }) {
  const [editing, setEditing] = useState(svc._new ?? false)
  const [form, setForm] = useState({ name: svc.name ?? '', type: svc.type ?? 'http', url: svc.url ?? '', expect_status: svc.expect_status ?? 200 })
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const save = () => { onSave(idx, form); setEditing(false) }
  const cancel = () => { if (svc._new) onDelete(idx); else setEditing(false) }
  const inputCls = 'bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/40 rounded px-2 py-1 text-xs text-slate-200 outline-none w-full'

  if (editing) {
    return (
      <tr className="border-b border-[#0f0f1a]">
        <td className="px-3 py-2"><input className={inputCls} value={form.name} onChange={set('name')} placeholder="Plex" /></td>
        <td className="px-3 py-2">
          <select className={inputCls} value={form.type} onChange={set('type')}>
            <option value="http">http</option>
            <option value="docker">docker</option>
          </select>
        </td>
        <td className="px-3 py-2"><input className={inputCls} value={form.url} onChange={set('url')} placeholder="http://192.168.1.10:32400" /></td>
        <td className="px-3 py-2 w-20"><input className={inputCls + ' text-center'} type="number" value={form.expect_status} onChange={set('expect_status')} /></td>
        <td className="px-3 py-2 w-16">
          <div className="flex items-center gap-1.5">
            <button onClick={save}   title="Save changes"  className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={cancel} title="Cancel"        className="p-1 text-slate-600 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
          </div>
        </td>
      </tr>
    )
  }
  return (
    <tr className="border-b border-[#0f0f1a] hover:bg-white/[0.02] transition-colors group">
      <td className="px-3 py-2.5 text-xs text-slate-300">{svc.name}</td>
      <td className="px-3 py-2.5"><span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded px-1.5 py-0.5">{svc.type || 'http'}</span></td>
      <td className="px-3 py-2.5 text-xs text-slate-500 font-mono truncate max-w-xs">{svc.url}</td>
      <td className="px-3 py-2.5 text-xs text-slate-500 text-center">{svc.expect_status ?? 200}</td>
      <td className="px-3 py-2.5 w-16">
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} title="Edit service"   className="p-1 text-slate-600 hover:text-indigo-400"><Edit2 className="w-3 h-3" /></button>
          <button onClick={() => onDelete(idx)}      title="Delete service" className="p-1 text-slate-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
        </div>
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Settings({ onOpenWizard, configStatus }) {
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)

  // Run Now dialog + toasts
  const [activeJob, setActiveJob] = useState(null)
  const [bgJobs,    setBgJobs]    = useState([])
  const [toasts,    setToasts]    = useState([])
  const bgJobsRef = useRef([])
  // eslint-disable-next-line react-hooks/refs
  bgJobsRef.current = bgJobs

  function showToast(message, type = 'success') {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('job_done', e => {
      const data = JSON.parse(e.data)
      if (bgJobsRef.current.includes(data.job)) {
        showToast(`${JOBS[data.job]?.label ?? data.job} completed`)
        setBgJobs(prev => prev.filter(j => j !== data.job))
      }
    })
    es.onerror = () => {}
    return () => es.close()
  }, [])

  function handleRunNow(jobId)     { setActiveJob(jobId) }
  function handleJobClose()        { setActiveJob(null) }
  function handleJobBackground(id) {
    setBgJobs(prev => [...prev.filter(j => j !== id), id])
    showToast(`${JOBS[id]?.label} running in background…`, 'info')
    setActiveJob(null)
  }

  // Config state
  const [piHost,                setPiHost]                = useState('')
  const [piUser,                setPiUser]                = useState('')
  const [sshKey,                setSshKey]                = useState('')
  const [subnets,               setSubnets]               = useState([])
  const [detecting,             setDetecting]             = useState(false)
  const [checkInterval,         setCheckInterval]         = useState(5)
  const [internetCheckInterval, setInternetCheckInterval] = useState(5)
  const [speedtestInterval,     setSpeedtestInterval]     = useState(1)
  const [threatInterval,        setThreatInterval]        = useState(6)
  const [pingInterval,          setPingInterval]          = useState(5)
  const [deepScanHour,          setDeepScanHour]          = useState(4)
  const [retentionDays,         setRetentionDays]         = useState(90)
  const [connectivityHosts,     setConnectivityHosts]     = useState(['1.1.1.1'])
  const [fallbackDns,           setFallbackDns]           = useState([])
  const [dormantAfterDays,      setDormantAfterDays]      = useState(3)
  const [skullAfterDays,        setSkullAfterDays]        = useState(7)
  const [ispName,               setIspName]               = useState('')
  const [ispConnectionType,     setIspConnectionType]     = useState('fibre')
  const [ispExpectedUptime,     setIspExpectedUptime]     = useState(100)
  const [ispPlanDown,           setIspPlanDown]           = useState(0)
  const [ispPlanUp,             setIspPlanUp]             = useState(0)
  const [ispAccountNumber,      setIspAccountNumber]      = useState('')
  const [ispSupportEmail,       setIspSupportEmail]       = useState('')
  const [theme,                 setTheme]                 = useState('dark')
  const [services,              setServices]              = useState([])
  const [backupIntervalDays,        setBackupIntervalDays]        = useState(0)
  const [backupKeepDays,             setBackupKeepDays]             = useState(7)
  const [internetOutageCheckSecs,    setInternetOutageCheckSecs]    = useState(10)
  const [backingUp,             setBackingUp]             = useState(false)
  const [restoring,             setRestoring]             = useState(false)
  const restoreInputRef = useRef(null)

  useEffect(() => {
    api.config.get()
      .then(cfg => {
        setPiHost(cfg.pi?.host ?? '')
        setPiUser(cfg.pi?.ssh_user ?? '')
        setSshKey(cfg.pi?.ssh_key ?? '')
        setSubnets(cfg.network?.subnets ?? (cfg.network?.subnet ? [cfg.network.subnet] : []))
        setCheckInterval(cfg.schedule?.check_interval_minutes ?? 5)
        setInternetCheckInterval(cfg.schedule?.internet_check_minutes ?? 5)
        setSpeedtestInterval(cfg.schedule?.speedtest_interval_hours ?? 1)
        setThreatInterval(cfg.schedule?.threat_interval_hours ?? 6)
        setPingInterval(cfg.schedule?.ping_interval_minutes ?? 5)
        setDeepScanHour(cfg.schedule?.deep_scan_hour ?? 4)
        setRetentionDays(cfg.retention?.days ?? 90)
        setConnectivityHosts(cfg.network?.connectivity_hosts ?? ['1.1.1.1'])
        setFallbackDns(cfg.network?.fallback_dns ?? [])
        setDormantAfterDays(cfg.network?.dormant_after_days ?? 3)
        setSkullAfterDays(cfg.network?.skull_after_days ?? 7)
        setIspName(cfg.isp?.name ?? '')
        setIspConnectionType(cfg.isp?.connection_type ?? 'fibre')
        setIspExpectedUptime(cfg.isp?.expected_uptime ?? 100)
        setIspPlanDown(cfg.isp?.plan_download_mbps ?? 0)
        setIspPlanUp(cfg.isp?.plan_upload_mbps ?? 0)
        setIspAccountNumber(cfg.isp?.account_number ?? '')
        setIspSupportEmail(cfg.isp?.support_email ?? '')
        setTheme(cfg.ui?.theme ?? 'dark')
        setServices(cfg.services ?? [])
        setBackupIntervalDays(cfg.schedule?.backup_interval_days ?? 0)
        setBackupKeepDays(cfg.schedule?.backup_keep_days ?? 7)
        setInternetOutageCheckSecs(cfg.schedule?.internet_outage_check_seconds ?? 10)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const addService    = () => setServices(prev => [...prev, { name: '', type: 'http', url: '', expect_status: 200, _new: true }])
  const updateService = (idx, data) => setServices(prev => prev.map((s, i) => i === idx ? { ...data } : s))
  const deleteService = (idx) => setServices(prev => prev.filter((_, i) => i !== idx))

  const schedulePayload = () => ({
    check_interval_minutes:   parseInt(checkInterval),
    internet_check_minutes:   parseInt(internetCheckInterval),
    threat_interval_hours:    parseInt(threatInterval),
    ping_interval_minutes:    parseInt(pingInterval),
    deep_scan_hour:           parseInt(deepScanHour),
    speedtest_interval_hours: parseInt(speedtestInterval),
    backup_interval_days:          parseInt(backupIntervalDays) || 0,
    backup_keep_days:              Math.max(1, parseInt(backupKeepDays) || 7),
    internet_outage_check_seconds: Math.max(5, parseInt(internetOutageCheckSecs) || 10),
  })

  const ispPayload = () => ({
    name:                ispName.trim(),
    connection_type:     ispConnectionType,
    expected_uptime:     parseFloat(ispExpectedUptime) || 100,
    plan_download_mbps:  parseFloat(ispPlanDown) || 0,
    plan_upload_mbps:    parseFloat(ispPlanUp)   || 0,
    account_number:      ispAccountNumber.trim(),
    support_email:       ispSupportEmail.trim(),
  })

  const onThemeChange = async (newTheme) => {
    setTheme(newTheme)
    applyTheme(newTheme)
    localStorage.setItem('claudette:theme', newTheme)
    try {
      await api.config.save({
        pi: { host: piHost, ssh_user: piUser, ssh_key: sshKey },
        network: { subnets, connectivity_hosts: connectivityHosts.filter(h => h.trim()), fallback_dns: fallbackDns.filter(h => h.trim()), dormant_after_days: parseInt(dormantAfterDays) || 3, skull_after_days: parseInt(skullAfterDays) || 7 },
        schedule: schedulePayload(),
        retention: { days: parseInt(retentionDays) },
        services: services.filter(s => s.name && s.url),
        isp: ispPayload(),
        ui: { theme: newTheme },
      }, true)
    } catch { /* fail silently */ }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.config.save({
        pi: { host: piHost, ssh_user: piUser, ssh_key: sshKey },
        network: { subnets, connectivity_hosts: connectivityHosts.filter(h => h.trim()), fallback_dns: fallbackDns.filter(h => h.trim()), dormant_after_days: parseInt(dormantAfterDays) || 3, skull_after_days: parseInt(skullAfterDays) || 7 },
        schedule: schedulePayload(),
        retention: { days: parseInt(retentionDays) },
        services: services.filter(s => s.name && s.url),
        isp: ispPayload(),
        ui: { theme },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-5 h-5 text-indigo-400/40 animate-spin" />
      </div>
    )
  }

  return (
    <>
      {activeJob && (
        <RunJobDialog jobId={activeJob} onClose={handleJobClose} onBackground={handleJobBackground} />
      )}
      <ToastContainer toasts={toasts} />

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a30] flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white">Settings</h1>
            <p className="text-slate-500 text-xs mt-0.5">Configure Claudette</p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenWizard && (
              <button onClick={onOpenWizard}
                className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg text-xs transition-colors">
                <Wand2 className="w-3.5 h-3.5" />Re-run Wizard
              </button>
            )}
            {onOpenWizard && (
              <button
                onClick={async () => {
                  if (!window.confirm('Delete config.yaml and restart the setup wizard?\n\nThis will NOT delete your scan data or audit log.')) return
                  try {
                    await api.config.reset()
                    window.location.reload()
                  } catch (e) {
                    alert('Failed to reset config: ' + e.message)
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-red-500/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg text-xs transition-colors">
                <Trash2 className="w-3.5 h-3.5" />Reset Config
              </button>
            )}
            <button onClick={save} disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                saved ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/25'
                      : 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white'
              }`}>
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 max-w-2xl">

          {/* Pi / Server */}
          <section>
            <SectionHeading>Pi / Server</SectionHeading>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <label className="block text-xs font-medium text-slate-300">Host IP</label>
                    {piHost === '192.168.1.10' && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-none">example value</span>
                    )}
                  </div>
                  <button type="button" disabled={detecting} onClick={async () => {
                    setDetecting(true)
                    try {
                      const { interfaces } = await api.system.interfaces()
                      if (interfaces?.length) {
                        setPiHost(interfaces[0].ip)
                        if (subnets.length === 0) setSubnets([interfaces[0].subnet])
                      }
                    } catch { /* ignore */ } finally { setDetecting(false) }
                  }} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors">
                    {detecting
                      ? <><span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" /> Detecting…</>
                      : <><Network className="w-2.5 h-2.5" /> Auto-detect</>}
                  </button>
                </div>
                <input value={piHost} onChange={e => setPiHost(e.target.value)} placeholder="192.168.1.10"
                  className={`w-full rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors ${piHost === '192.168.1.10' ? 'bg-amber-500/5 border border-amber-500/40 focus:border-amber-400/60' : 'bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50'}`} />
              </div>
              <Field label="SSH User" value={piUser} onChange={e => setPiUser(e.target.value)} placeholder="ubuntu" />
              <div className="col-span-2">
                <Field label="SSH Key Path" hint="Optional — uses ssh-agent if left blank" value={sshKey} onChange={e => setSshKey(e.target.value)} placeholder="~/.ssh/id_rsa" />
              </div>
            </div>
          </section>

          {/* Network */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <SectionHeading>Network Scan Ranges</SectionHeading>
                {subnets.some(s => s === '192.168.1.0/24') && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-none">needs setup</span>
                )}
              </div>
              <button onClick={() => setSubnets(p => [...p, ''])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Range
              </button>
            </div>
            {subnets.length === 0 && <p className="text-xs text-slate-700 py-2">Auto-detected from host IP. Add a range to override.</p>}
            <div className="space-y-2 max-w-xs">
              {subnets.map((s, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <input value={s} onChange={e => setSubnets(p => p.map((x, j) => j === i ? e.target.value : x))}
                      placeholder="192.168.1.0/24"
                      className={`flex-1 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono ${s === '192.168.1.0/24' ? 'bg-amber-500/5 border border-amber-500/40 focus:border-amber-400/60' : 'bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50'}`} />
                    <button onClick={() => setSubnets(p => p.filter((_, j) => j !== i))} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {s === '192.168.1.0/24' && (
                    <p className="text-[10px] text-amber-400/80 mt-0.5 ml-1">Replace with your actual network range</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Schedule */}
          <section>
            <SectionHeading>Schedule</SectionHeading>
            <p className="text-[11px] text-slate-500 mb-3">Jobs run at clock-aligned times and queue up so they never overlap.</p>
            <div className="space-y-3 max-w-lg">
              {[
                { jobId: 'services', label: 'Service check',   opts: MIN_OPTS, value: checkInterval,         set: v => setCheckInterval(parseInt(v)) },
                { jobId: 'internet', label: 'Internet check',  opts: MIN_OPTS, value: internetCheckInterval, set: v => setInternetCheckInterval(parseInt(v)) },
                { jobId: 'ping',     label: 'Ping sweep',      opts: MIN_OPTS, value: pingInterval,          set: v => setPingInterval(parseInt(v)) },
                { jobId: 'threats',  label: 'Threat refresh',  opts: HR_OPTS,  value: threatInterval,        set: v => setThreatInterval(parseInt(v)) },
                { jobId: 'speedtest',label: 'Speed test',      opts: HR_OPTS,  value: speedtestInterval,     set: v => setSpeedtestInterval(parseInt(v)) },
              ].map(({ jobId, label, opts, value, set }) => (
                <div key={jobId} className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                    <select value={value} onChange={e => set(e.target.value)}
                      className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <button onClick={() => handleRunNow(jobId)}
                    className="mt-5 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-lg transition-colors whitespace-nowrap">
                    <Play className="w-3 h-3" />Run now
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 max-w-lg">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Outage fast-poll interval (seconds)
                {configStatus?.outdated && (
                  <span className="ml-2 text-[10px] font-semibold text-amber-400 uppercase tracking-wide">New in v0.0.8</span>
                )}
              </label>
              <input
                type="number" min="5" max="300" step="1"
                value={internetOutageCheckSecs}
                onChange={e => setInternetOutageCheckSecs(Math.max(5, parseInt(e.target.value) || 10))}
                className={`w-32 bg-[#080812] rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors ${
                  configStatus?.outdated
                    ? 'border border-amber-500/50 focus:border-amber-400'
                    : 'border border-[#1a1a30] focus:border-indigo-500/50'
                }`}
              />
              <p className="text-[11px] text-slate-600 mt-1">How often to ping while internet is down — switches back to normal interval once restored (min 5s)</p>
            </div>
            <div className="mt-3 max-w-lg">
              <label className="block text-xs font-medium text-slate-400 mb-1">Nightly deep scan time</label>
              <select value={deepScanHour} onChange={e => setDeepScanHour(parseInt(e.target.value))}
                className="w-56 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                {HOUR_LABELS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
              <p className="text-[11px] text-slate-600 mt-1">Full port scan of all discovered devices — runs once daily</p>
            </div>
            <div className="mt-4 max-w-xs space-y-1">
              <label className="block text-xs font-medium text-slate-400">Data retention</label>
              <select value={retentionDays} onChange={e => setRetentionDays(parseInt(e.target.value))}
                className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
              </select>
              <p className="text-[11px] text-slate-600">Events older than this are pruned nightly at 3 am</p>
            </div>
          </section>

          {/* Connectivity */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <SectionHeading>Connectivity Check Hosts</SectionHeading>
              <button onClick={() => setConnectivityHosts(p => [...p, ''])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Host
              </button>
            </div>
            <p className="text-[11px] text-slate-600 mb-3">IPs to ping for internet connectivity checks. Default: 1.1.1.1.</p>
            <div className="space-y-2 max-w-xs">
              {connectivityHosts.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={h} onChange={e => setConnectivityHosts(p => p.map((x, j) => j === i ? e.target.value : x))}
                    placeholder="1.1.1.1"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono" />
                  <button onClick={() => setConnectivityHosts(p => p.filter((_, j) => j !== i))} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Fallback DNS */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <SectionHeading>Fallback DNS</SectionHeading>
              <button onClick={() => setFallbackDns(p => [...p, ''])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Server
              </button>
            </div>
            <p className="text-[11px] text-slate-600 mb-3">
              Fallback DNS servers passed to the Docker container via <span className="font-mono">--dns</span>. Used when your primary DNS resolver is unreachable. Applied on next deploy. Up to 3 entries.
            </p>
            <div className="space-y-2 max-w-xs">
              {fallbackDns.length === 0 && (
                <p className="text-[11px] text-slate-700 italic">None configured — Docker will use the Pi&apos;s resolv.conf only.</p>
              )}
              {fallbackDns.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={h} onChange={e => setFallbackDns(p => p.map((x, j) => j === i ? e.target.value : x))}
                    placeholder="8.8.8.8"
                    className="flex-1 bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-700 outline-none transition-colors font-mono" />
                  <button onClick={() => setFallbackDns(p => p.filter((_, j) => j !== i))} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Device Lifecycle */}
          <section>
            <SectionHeading>Device Lifecycle</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Thresholds for auto-managing devices that stop responding.</p>
            <div className="grid grid-cols-2 gap-4 max-w-xs">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Auto-dormant after (days)</label>
                <input type="number" min="1" max="365" step="1"
                  value={dormantAfterDays}
                  onChange={e => setDormantAfterDays(Math.max(1, parseInt(e.target.value) || 3))}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
                />
                <p className="text-[11px] text-slate-600 mt-1">🌙 Moon icon — device silenced</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Skull warning after (days)</label>
                <input type="number" min="1" max="365" step="1"
                  value={skullAfterDays}
                  onChange={e => setSkullAfterDays(Math.max(1, parseInt(e.target.value) || 7))}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors"
                />
                <p className="text-[11px] text-slate-600 mt-1">💀 Skull icon — long-term unreachable</p>
              </div>
            </div>
          </section>

          {/* ISP */}
          <section>
            <SectionHeading>ISP / Internet Provider</SectionHeading>
            <p className="text-[11px] text-slate-600 mb-4">Used in outage reports and exports sent to your provider.</p>
            <div className="space-y-3 max-w-xs">
              <Field label="ISP Name" value={ispName} onChange={e => setIspName(e.target.value)} placeholder="e.g. MetroFibre" />
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Connection Type</label>
                <select value={ispConnectionType} onChange={e => setIspConnectionType(e.target.value)}
                  className="w-full bg-[#080812] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none transition-colors">
                  {['fibre','dsl','lte','cable','satellite','broadband'].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <Field label="Expected Uptime %" type="number" min="90" max="100" step="0.001"
                value={ispExpectedUptime} onChange={e => setIspExpectedUptime(e.target.value)} placeholder="100" />
              <Field label="Plan Download Speed (Mbps)" type="number" min="0" max="10000" step="1"
                value={ispPlanDown || ''} onChange={e => setIspPlanDown(e.target.value)} placeholder="e.g. 250" />
              <Field label="Plan Upload Speed (Mbps)" type="number" min="0" max="10000" step="1"
                value={ispPlanUp || ''} onChange={e => setIspPlanUp(e.target.value)} placeholder="e.g. 250" />
              <Field label="Account / Contract No." value={ispAccountNumber} onChange={e => setIspAccountNumber(e.target.value)} placeholder="optional" />
              <Field label="Support Email" type="email" value={ispSupportEmail} onChange={e => setIspSupportEmail(e.target.value)} placeholder="support@isp.example.com" />
            </div>
          </section>

          {/* Appearance */}
          <section>
            <SectionHeading>Appearance</SectionHeading>
            <div className="grid grid-cols-5 gap-2.5 max-w-2xl">
              {THEMES.map(t => (
                <button key={t.id} type="button" onClick={() => onThemeChange(t.id)}
                  className={`flex flex-col overflow-hidden rounded-xl border-2 transition-all ${
                    theme === t.id
                      ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
                      : 'border-[#1a1a30] hover:border-[#2a2a45]'
                  }`}>
                  <div className="w-full h-14 flex-shrink-0" style={{ background: t.preview }} />
                  <div className={`px-2 py-1.5 text-center ${theme === t.id ? 'bg-indigo-600/15' : 'bg-[#0a0a18]'}`}>
                    <span className="text-[10px] font-medium text-slate-300 leading-tight block">{t.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Data & Backup */}
          <section>
            <SectionHeading>Data &amp; Backup</SectionHeading>
            <div className="space-y-4">
              <Field
                label="Auto-backup every N days (0 = disabled)"
                hint="Creates a .claudette.gz backup in the claudette-data Docker volume on the Pi (/app/data/backups/). Same disk as the database — useful for accidental changes, not hardware failure. For offsite copies, use Backup Now."
                type="number" min="0" max="365"
                value={backupIntervalDays}
                onChange={e => setBackupIntervalDays(e.target.value)}
                placeholder="0"
              />
              <Field
                label="Keep auto-backups for (days)"
                hint="Auto-backups older than this are deleted from the Pi. Manual downloads are not affected."
                type="number" min="1" max="365"
                value={backupKeepDays}
                onChange={e => setBackupKeepDays(e.target.value)}
                placeholder="7"
              />
              <div className="flex items-center gap-3 pt-1">
                {/* Manual backup download */}
                <button
                  onClick={async () => {
                    try {
                      setBackingUp(true)
                      await api.system.backup()
                      showToast('Backup downloaded')
                    } catch (err) {
                      showToast(err.message, 'error')
                    } finally {
                      setBackingUp(false)
                    }
                  }}
                  disabled={backingUp || restoring}
                  className="flex items-center gap-2 px-3 py-2 text-xs border border-[#1a1a30] text-slate-400 hover:text-slate-200 hover:border-[#2a2a45] rounded-lg transition-colors disabled:opacity-40"
                >
                  {backingUp
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Backing up…</>
                    : <><Download className="w-3.5 h-3.5" />Backup Now</>}
                </button>

                {/* Restore from file */}
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".claudette.gz"
                  className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (!window.confirm(`Restore from "${file.name}"?\n\nThis will overwrite the current database and config. The page will reload.`)) {
                      e.target.value = ''
                      return
                    }
                    try {
                      setRestoring(true)
                      const buf = await file.arrayBuffer()
                      await api.system.restore(buf)
                      showToast('Restore complete — reloading…')
                      setTimeout(() => window.location.reload(), 1500)
                    } catch (err) {
                      showToast(err.message, 'error')
                    } finally {
                      setRestoring(false)
                      e.target.value = ''
                    }
                  }}
                />
                <button
                  onClick={() => restoreInputRef.current?.click()}
                  disabled={backingUp || restoring}
                  className="flex items-center gap-2 px-3 py-2 text-xs border border-amber-500/30 text-amber-400/80 hover:text-amber-300 hover:border-amber-500/50 rounded-lg transition-colors disabled:opacity-40"
                >
                  {restoring
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Restoring…</>
                    : <><Upload className="w-3.5 h-3.5" />Restore from File</>}
                </button>
              </div>
              <p className="text-[11px] text-slate-600">Backup files (.claudette.gz) are gzip-compressed and contain the full database and config. Keep them somewhere safe.</p>
            </div>
          </section>

          {/* Monitored Services */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <SectionHeading>Monitored Services</SectionHeading>
              <button onClick={addService}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/25 hover:border-indigo-500/50 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add Service
              </button>
            </div>
            {services.length === 0 ? (
              <p className="text-xs text-slate-700 py-4">No services configured. Add one above.</p>
            ) : (
              <div className="border border-[#1a1a30] rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-slate-600 uppercase tracking-wider border-b border-[#1a1a30] bg-[#080812]">
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2 w-16">Type</th>
                      <th className="text-left px-3 py-2">URL</th>
                      <th className="text-center px-3 py-2 w-20">Expect</th>
                      <th className="px-3 py-2 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((svc, idx) => (
                      <ServiceRow key={idx} svc={svc} idx={idx} onSave={updateService} onDelete={deleteService} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </div>
      </div>
    </>
  )
}
