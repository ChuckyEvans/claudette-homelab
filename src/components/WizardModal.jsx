import { useState, useEffect } from 'react'
import { Zap, ChevronRight, Network, Server, Check, X, Info, FileEdit, Lock, Eye, EyeOff, Plus, Clock, Palette } from 'lucide-react'
import { api } from '../lib/api.js'
import { THEMES, applyTheme } from '../lib/themes.js'
const claudetteLogo = '/favicon.svg'

const STEPS = [
  { label: 'Network' },
  { label: 'Services' },
  { label: 'Schedule' },
  { label: 'ISP / SLA' },
  { label: 'Appearance' },
  { label: 'Done' },
]

/** Convert any CIDR (host or network) to proper network address, e.g. 192.168.8.10/24 → 192.168.8.0/24 */
function normalizeSubnet(raw) {
  const m = raw.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  if (!m) return raw.trim()
  const [, a, b, c, , prefix] = m
  const p = parseInt(prefix)
  if (p >= 24) return `${a}.${b}.${c}.0/${prefix}`
  if (p >= 16) return `${a}.${b}.0.0/${prefix}`
  if (p >= 8)  return `${a}.0.0.0/${prefix}`
  return raw.trim()
}

/** Derive a /24 subnet from a host IP, e.g. 192.168.8.10 → 192.168.8.0/24 */
function subnetFromHost(ip) {
  const m = ip.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/)
  return m ? `${m[1]}.0/24` : ''
}

function StepDots({ current, total }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`rounded-full transition-all ${
            i === current
              ? 'w-6 h-2 bg-indigo-500'
              : i < current
              ? 'w-2 h-2 bg-indigo-700'
              : 'w-2 h-2 bg-[#1a1a35]'
          }`}
        />
      ))}
    </div>
  )
}

function Field({ label, hint, needsConfig = false, ...inputProps }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="block text-xs font-medium text-slate-300">{label}</label>
        {needsConfig && (
          <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-none">example value</span>
        )}
      </div>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      <input
        {...inputProps}
        className={`w-full rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition-colors ${needsConfig ? 'bg-amber-500/5 border border-amber-500/40 focus:border-amber-400/60' : 'bg-[#0a0a18] border border-[#1a1a35] focus:border-indigo-500/60'}`}
      />
    </div>
  )
}

export default function WizardModal({ onComplete, onSkip, configExists = false, configValid = false, configOutdated = false, needsAccount = false, onRegistered }) {
  // step -1 = create account, 0 = welcome, 1 = network+server, 2 = services, 3 = schedule, 4 = ISP/SLA, 5 = appearance, 6 = done
  const [step, setStep] = useState(needsAccount ? -1 : 0)
  const [acct, setAcct] = useState({ username: '', password: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [acctError, setAcctError] = useState(null)
  const [acctSaving, setAcctSaving] = useState(false)
  const [form, setForm] = useState({
    piHost: '192.168.1.10',
    piUser: 'ubuntu',
    sshKey: '',
    subnets: ['192.168.1.0/24'],
    checkInterval: 5,
    internetCheckInterval: 5,
    internetOutageCheckSecs: 10,
    speedtestInterval: 1,
    threatInterval: 6,
    deepScanHour: 4,
    retentionDays: 90,
    connectivityHosts: ['1.1.1.1'],
    services: [],
    theme:    'starfield',
    ispName: '',
    ispConnectionType: 'fibre',
    ispExpectedUptime: 100,
    ispPlanDown: 0,
    ispPlanUp: 0,
  })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [testing, setTesting]   = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [skipTest, setSkipTest] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [showSsh, setShowSsh] = useState(false)
  const [newSvc, setNewSvc]     = useState(null) // null | { name, type, url, expect_status }

  // Auto-detect host IP + subnet when entering step 1 for a fresh config
  const autoDetect = async () => {
    setDetecting(true)
    try {
      const { interfaces } = await api.system.interfaces()
      if (interfaces?.length) {
        const iface = interfaces[0]
        setForm(p => ({
          ...p,
          piHost:  iface.ip,
          subnets: [iface.subnet],
        }))
      }
    } catch { /* ignore */ } finally {
      setDetecting(false)
    }
  }

  useEffect(() => {
    if (step === 1 && !configExists) autoDetect()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate form from existing config
  useEffect(() => {
    if (configExists) {
      api.config.get().then(cfg => {
        if (!cfg) return
        setForm({
          piHost:         cfg.pi?.host     ?? '192.168.1.10',
          piUser:         cfg.pi?.ssh_user ?? 'ubuntu',
          sshKey:         cfg.pi?.ssh_key  ?? '',
          subnets:        cfg.network?.subnets ?? (cfg.network?.subnet ? [cfg.network.subnet] : (cfg.pi?.host ? [subnetFromHost(cfg.pi.host)] : ['192.168.1.0/24'])),
          checkInterval:  cfg.schedule?.check_interval_minutes ?? 5,
          internetCheckInterval: cfg.schedule?.internet_check_minutes ?? 5,
          internetOutageCheckSecs: cfg.schedule?.internet_outage_check_seconds ?? 10,
          speedtestInterval: cfg.schedule?.speedtest_interval_hours ?? 1,
          threatInterval: cfg.schedule?.threat_interval_hours  ?? 6,
          deepScanHour:   cfg.schedule?.deep_scan_hour         ?? 4,
          retentionDays:  cfg.retention?.days                  ?? 90,
          connectivityHosts: cfg.network?.connectivity_hosts   ?? ['1.1.1.1'],
          services:       cfg.services ?? [],
          theme:          cfg.ui?.theme  ?? 'dark',
          ispName:            cfg.isp?.name             ?? '',
          ispConnectionType:  cfg.isp?.connection_type  ?? 'fibre',
          ispExpectedUptime:  cfg.isp?.expected_uptime  ?? 100,
          ispPlanDown:        cfg.isp?.plan_download_mbps ?? 0,
          ispPlanUp:          cfg.isp?.plan_upload_mbps   ?? 0,
        })
      }).catch(() => {})
    }
  }, [configExists])

  const setFE = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const addSubnet    = () => setForm(p => ({ ...p, subnets: [...p.subnets, ''] }))
  const removeSubnet = (i) => setForm(p => ({ ...p, subnets: p.subnets.filter((_, j) => j !== i) }))
  const updateSubnet = (i, v) => setForm(p => ({ ...p, subnets: p.subnets.map((s, j) => j === i ? v : s) }))

  const commitService = () => {
    if (!newSvc?.name?.trim() || !newSvc?.url?.trim()) return
    setForm(p => ({ ...p, services: [...p.services, { ...newSvc }] }))
    setNewSvc(null)
  }
  const removeService = (i) => setForm(p => ({ ...p, services: p.services.filter((_, j) => j !== i) }))

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.network.pingHost(form.piHost.trim())
      setTestResult(result)
    } catch (err) {
      setTestResult({ error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.config.save({
        pi:       { host: form.piHost, ssh_user: form.piUser, ssh_key: form.sshKey },
        network:  { subnets: form.subnets.filter(s => s.trim()), connectivity_hosts: form.connectivityHosts.filter(h => h.trim()) },
        schedule: { check_interval_minutes: parseInt(form.checkInterval) || 5, internet_check_minutes: parseInt(form.internetCheckInterval) || 5, internet_outage_check_seconds: Math.max(5, parseInt(form.internetOutageCheckSecs) || 10), speedtest_interval_hours: parseInt(form.speedtestInterval) || 1, threat_interval_hours: parseInt(form.threatInterval) || 6, deep_scan_hour: parseInt(form.deepScanHour) ?? 4 },
        retention: { days: parseInt(form.retentionDays) || 90 },
        services: form.services.filter(s => s.name && s.url),
        ui:       { theme: form.theme },
        isp: {
          name:               (form.ispName || '').trim(),
          connection_type:    form.ispConnectionType || 'fibre',
          expected_uptime:    parseFloat(form.ispExpectedUptime) || 100,
          plan_download_mbps: parseFloat(form.ispPlanDown) || 0,
          plan_upload_mbps:   parseFloat(form.ispPlanUp)   || 0,
        },
      })
      setStep(6)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d0d1a] border border-[#1a1a30] rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-8 pt-8 pb-0 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={claudetteLogo} alt="Claudette" className="w-8 h-8" />
            <span className="text-white font-bold tracking-widest text-sm uppercase">Claudette</span>
          </div>
          {step === 0 && (
            <button onClick={onSkip} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="px-8 py-6 overflow-y-auto flex-1">
          {step > 0 && step < 6 && <StepDots current={step - 1} total={5} />}

          {/* Step -1 — Create account */}
          {step === -1 && (
            <div className="space-y-5">
              <div className="text-center mb-2">
                <div className="w-14 h-14 bg-indigo-600/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-7 h-7 text-indigo-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-1">Create your account</h2>
                <p className="text-sm text-slate-500">This is the only account — choose a strong password.</p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Username</label>
                <input
                  type="text"
                  autoComplete="username"
                  value={acct.username}
                  onChange={e => setAcct(p => ({ ...p, username: e.target.value }))}
                  placeholder="e.g. admin"
                  className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={acct.password}
                    onChange={e => setAcct(p => ({ ...p, password: e.target.value }))}
                    placeholder="Min 8 characters"
                    className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Confirm password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={acct.confirm}
                  onChange={e => setAcct(p => ({ ...p, confirm: e.target.value }))}
                  className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
                />
              </div>
              {acctError && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{acctError}</p>
              )}
              <button
                onClick={async () => {
                  setAcctError(null)
                  if (acct.password !== acct.confirm) return setAcctError('Passwords do not match')
                  setAcctSaving(true)
                  try {
                    const res = await api.auth.register({ username: acct.username.trim(), password: acct.password })
                    onRegistered?.(res.username)
                    setStep(1)
                  } catch (err) {
                    setAcctError(err.message)
                  } finally {
                    setAcctSaving(false)
                  }
                }}
                disabled={acctSaving || !acct.username.trim() || acct.password.length < 8 || !acct.confirm}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
              >
                {acctSaving ? 'Creating…' : <><ChevronRight className="w-4 h-4" /> Create account &amp; continue</>}
              </button>
            </div>
          )}

          {/* Step 0 — Welcome */}
          {step === 0 && (
            <div className="text-center py-4">
              {configOutdated ? (
                <>
                  <div className="w-16 h-16 bg-amber-600/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Zap className="w-8 h-8 text-amber-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Claudette updated</h2>
                  <p className="text-sm text-slate-500 mb-8">
                    A new version was deployed. Your existing settings have been pre-filled below —
                    review them and click Save to confirm.
                  </p>
                </>
              ) : configExists ? (
                <>
                  <div className="w-16 h-16 bg-indigo-600/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <FileEdit className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Config already exists</h2>
                  <p className="text-sm text-slate-500 mb-8">
                    {configValid
                      ? 'Your setup looks good. You can edit your network and server settings below, or close this wizard.'
                      : 'A config file was found but it looks incomplete. Run through the wizard to finish setting it up.'}
                  </p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-indigo-600/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Zap className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Welcome to Claudette</h2>
                  <p className="text-sm text-slate-500 mb-8">
                    No config file found. Run the setup wizard to configure your network,
                    server details, and monitoring preferences.
                  </p>
                </>
              )}
              <div className="space-y-3">
                <button
                  onClick={() => setStep(1)}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
                >
                  {configOutdated
                    ? <><FileEdit className="w-4 h-4" /> Review Settings</>
                    : configExists
                    ? <><FileEdit className="w-4 h-4" /> Edit Settings</>
                    : <>Run Setup Wizard <ChevronRight className="w-4 h-4" /></>}
                </button>
                <button
                  onClick={onSkip}
                  className="w-full text-slate-500 hover:text-slate-300 py-2 text-sm transition-colors"
                >
                  {configOutdated ? 'Remind me later' : configExists ? 'Close' : 'Skip for now'}
                </button>
              </div>
            </div>
          )}

          {/* Step 1 — Network & Server */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-base font-bold text-white">Network &amp; Server</h2>
                </div>
                <p className="text-xs text-slate-500">The IP of the machine running Claudette and the subnets to scan.</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <label className="block text-xs font-medium text-slate-300">Server IP</label>
                    {form.piHost === '192.168.1.10' && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-none">example value</span>
                    )}
                  </div>
                  <button type="button" onClick={autoDetect} disabled={detecting}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors">
                    {detecting
                      ? <><span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin" /> Detecting…</>
                      : <><Network className="w-2.5 h-2.5" /> Auto-detect</>}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">IP address of this machine (Pi, Windows PC, etc.)</p>
                <input
                  value={form.piHost}
                  onChange={e => {
                    const ip = e.target.value
                    setTestResult(null)
                    setSkipTest(false)
                    setForm(p => {
                      const derived = subnetFromHost(ip)
                      const hasDefault = p.subnets.length === 1 && (p.subnets[0] === '' || p.subnets[0] === '192.168.1.0/24')
                      return { ...p, piHost: ip, ...(derived && hasDefault ? { subnets: [derived] } : {}) }
                    })
                  }}
                  placeholder="192.168.1.10"
                  className={`w-full rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition-colors ${form.piHost === '192.168.1.10' ? 'bg-amber-500/5 border border-amber-500/40 focus:border-amber-400/60' : 'bg-[#0a0a18] border border-[#1a1a35] focus:border-indigo-500/60'}`}
                />
              </div>

              {/* SSH — optional, collapsed by default */}
              <div>
                <button type="button" onClick={() => setShowSsh(v => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                  <ChevronRight className={`w-3 h-3 transition-transform ${showSsh ? 'rotate-90' : ''}`} />
                  SSH details (optional — Pi / Linux only)
                </button>
                {showSsh && (
                  <div className="mt-3 space-y-3 pl-4 border-l border-[#1a1a30]">
                    <p className="text-[11px] text-slate-600">Stored for reference only — not used by the app.</p>
                    <Field label="SSH User" value={form.piUser} onChange={setFE('piUser')} placeholder="ubuntu" />
                    <Field label="SSH Key Path" hint="Optional — uses ssh-agent if blank" value={form.sshKey} onChange={setFE('sshKey')} placeholder="~/.ssh/id_rsa" />
                  </div>
                )}
              </div>

              {/* Test connection */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    setTesting(true)
                    setTestResult(null)
                    try {
                      const result = await api.network.pingHost(form.piHost.trim())
                      setTestResult(result)
                    } catch (err) {
                      setTestResult({ error: err.message })
                    } finally {
                      setTesting(false)
                    }
                  }}
                  disabled={testing || !form.piHost.trim()}
                  className="flex items-center gap-2 px-4 py-2 border border-indigo-500/30 hover:border-indigo-500/60 text-indigo-400 hover:text-indigo-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {testing
                    ? <><span className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin" /> Testing…</>
                    : <><Network className="w-3.5 h-3.5" /> Test Connection</>}
                </button>
                {testResult && (
                  testResult.error
                    ? <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">Error: {testResult.error}</p>
                    : testResult.online
                      ? <p className="text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5" /> Reachable{testResult.latency != null ? ` · ${testResult.latency}ms` : ''}
                        </p>
                      : <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">No response — check the IP and ensure the host is online</p>
                )}
                {!skipTest && testResult && !testResult.online && (
                  <button type="button" onClick={() => setSkipTest(true)} className="text-[11px] text-slate-500 hover:text-slate-300 underline">
                    Continue anyway
                  </button>
                )}
              </div>

              {/* Scan ranges */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-slate-300">Scan Ranges (CIDR)</label>
                    {form.subnets.some(s => s === '192.168.1.0/24') && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-none">needs setup</span>
                    )}
                  </div>
                  <button onClick={addSubnet} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">
                    <Plus className="w-3 h-3" /> Add range
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">Subnets to scan for devices, e.g. 192.168.1.0/24</p>
                <div className="space-y-2">
                  {form.subnets.map((s, i) => {
                    const norm = normalizeSubnet(s)
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-2">
                          <input
                            value={s}
                            onChange={e => updateSubnet(i, e.target.value)}
                            placeholder="192.168.1.0/24"
                            className={`flex-1 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none transition-colors ${s === '192.168.1.0/24' ? 'bg-amber-500/5 border border-amber-500/40 focus:border-amber-400/60' : 'bg-[#0a0a18] border border-[#1a1a35] focus:border-indigo-500/60'}`}
                          />
                          {form.subnets.length > 1 && (
                            <button onClick={() => removeSubnet(i)} className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        {s === '192.168.1.0/24' && (
                          <p className="text-[10px] text-amber-400/80 mt-0.5 ml-1 flex items-center gap-1">
                            <Info className="w-2.5 h-2.5" /> Replace with your actual network range
                          </p>
                        )}
                        {s !== '192.168.1.0/24' && norm && norm !== s.trim() && s.trim() && (
                          <p className="text-[10px] text-amber-400/70 mt-0.5 ml-1 flex items-center gap-1">
                            <Info className="w-2.5 h-2.5" /> Will normalize to {norm}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(0)} className="flex-1 border border-[#1a1a35] text-slate-400 hover:text-slate-200 rounded-xl py-2.5 text-sm transition-colors">
                  Back
                </button>
                <button
                  onClick={() => {
                    setForm(p => ({ ...p, subnets: p.subnets.map(s => normalizeSubnet(s) || s).filter(s => s.trim()) }))
                    setStep(2)
                  }}
                  disabled={!form.piHost.trim() || (!testResult?.online && !skipTest && !configExists)}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Services */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-base font-bold text-white">Monitored Services</h2>
                </div>
                <p className="text-xs text-slate-500">HTTP endpoints and Docker containers to health-check. You can add more in Settings later.</p>
              </div>

              <div className="space-y-2">
                {form.services.map((svc, i) => (
                  <div key={i} className="flex items-center gap-2 bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-200">{svc.name}</span>
                        <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded px-1.5 py-0.5">{svc.type || 'http'}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{svc.url}</p>
                    </div>
                    <button onClick={() => removeService(i)} className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {form.services.length === 0 && !newSvc && (
                  <p className="text-xs text-slate-500 text-center py-3">No services added yet.</p>
                )}
              </div>

              {newSvc ? (
                <div className="bg-[#0a0a18] border border-indigo-500/30 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-medium text-slate-300">New service</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Name</label>
                      <input value={newSvc.name} onChange={e => setNewSvc(p => ({ ...p, name: e.target.value }))} placeholder="Plex"
                        className="w-full bg-[#080812] border border-[#1a1a35] rounded-lg px-2.5 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Type</label>
                      <select value={newSvc.type} onChange={e => setNewSvc(p => ({ ...p, type: e.target.value }))}
                        className="w-full bg-[#080812] border border-[#1a1a35] rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/60 transition-colors">
                        <option value="http">http</option>
                        <option value="docker">docker</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">URL / Container name</label>
                    <input value={newSvc.url} onChange={e => setNewSvc(p => ({ ...p, url: e.target.value }))} placeholder="http://192.168.1.10:32400"
                      className="w-full bg-[#080812] border border-[#1a1a35] rounded-lg px-2.5 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors" />
                  </div>
                  {newSvc.type === 'http' && (
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Expected HTTP status</label>
                      <input type="number" value={newSvc.expect_status} onChange={e => setNewSvc(p => ({ ...p, expect_status: parseInt(e.target.value) || 200 }))}
                        className="w-24 bg-[#080812] border border-[#1a1a35] rounded-lg px-2.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/60 transition-colors" />
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={commitService} disabled={!newSvc.name?.trim() || !newSvc.url?.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors">
                      <Check className="w-3.5 h-3.5" /> Add
                    </button>
                    <button onClick={() => setNewSvc(null)} className="px-3 py-1.5 border border-[#1a1a35] text-slate-400 hover:text-slate-200 rounded-lg text-xs transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setNewSvc({ name: '', type: 'http', url: '', expect_status: 200 })}
                  className="w-full flex items-center justify-center gap-2 border border-dashed border-[#1a1a35] hover:border-indigo-500/40 text-slate-500 hover:text-indigo-400 rounded-xl py-3 text-xs transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Service
                </button>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="flex-1 border border-[#1a1a35] text-slate-400 hover:text-slate-200 rounded-xl py-2.5 text-sm transition-colors">
                  Back
                </button>
                <button onClick={() => setStep(3)}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Schedule */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-base font-bold text-white">Schedule</h2>
                </div>
                <p className="text-xs text-slate-500">How often Claudette checks your services and fetches threat intelligence.</p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Service check interval</label>
                <p className="text-[11px] text-slate-500">How often to ping your monitored services</p>
                <div className="flex items-center gap-3">
                  <input type="number" min="1" max="60" value={form.checkInterval}
                    onChange={e => setForm(p => ({ ...p, checkInterval: Math.max(1, parseInt(e.target.value) || 5) }))}
                    className="w-24 bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center focus:outline-none focus:border-indigo-500/60 transition-colors" />
                  <span className="text-xs text-slate-500">minutes</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Internet check interval</label>
                <p className="text-[11px] text-slate-500">How often to verify internet connectivity</p>
                <div className="flex items-center gap-3">
                  <input type="number" min="1" max="60" value={form.internetCheckInterval}
                    onChange={e => setForm(p => ({ ...p, internetCheckInterval: Math.max(1, parseInt(e.target.value) || 5) }))}
                    className="w-24 bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center focus:outline-none focus:border-indigo-500/60 transition-colors" />
                  <span className="text-xs text-slate-500">minutes</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={`block text-xs font-medium ${configOutdated ? 'text-amber-400' : 'text-slate-300'}`}>
                  Outage fast-poll interval
                  {configOutdated && <span className="ml-1.5 text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full">New</span>}
                </label>
                <p className="text-[11px] text-slate-500">How often to ping during an active outage (seconds)</p>
                <div className="flex items-center gap-3">
                  <input type="number" min="5" max="300"
                    value={form.internetOutageCheckSecs}
                    onChange={e => setForm(p => ({ ...p, internetOutageCheckSecs: Math.max(5, parseInt(e.target.value) || 10) }))}
                    className={`w-24 rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center focus:outline-none transition-colors ${
                      configOutdated
                        ? 'bg-amber-950/30 border border-amber-500/40 focus:border-amber-400'
                        : 'bg-[#0a0a18] border border-[#1a1a35] focus:border-indigo-500/60'
                    }`} />
                  <span className="text-xs text-slate-500">seconds (min 5)</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Speed test interval</label>
                <p className="text-[11px] text-slate-500">How often to run a full download/upload speed test</p>
                <div className="flex items-center gap-3">
                  <input type="number" min="1" max="168" value={form.speedtestInterval}
                    onChange={e => setForm(p => ({ ...p, speedtestInterval: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-24 bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center focus:outline-none focus:border-indigo-500/60 transition-colors" />
                  <span className="text-xs text-slate-500">hours</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Threat feed interval</label>
                <p className="text-[11px] text-slate-500">How often to fetch CVE / threat intelligence</p>
                <div className="flex items-center gap-3">
                  <input type="number" min="1" max="168" value={form.threatInterval}
                    onChange={e => setForm(p => ({ ...p, threatInterval: Math.max(1, parseInt(e.target.value) || 6) }))}
                    className="w-24 bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center focus:outline-none focus:border-indigo-500/60 transition-colors" />
                  <span className="text-xs text-slate-500">hours</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Auto deep-scan hour</label>
                  <p className="text-[11px] text-slate-500">Hour of day (0–23) to run nightly deep scan</p>
                  <input type="number" min="0" max="23" value={form.deepScanHour}
                    onChange={e => setForm(p => ({ ...p, deepScanHour: Math.min(23, Math.max(0, parseInt(e.target.value) || 4)) }))}
                    className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center focus:outline-none focus:border-indigo-500/60 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Data retention</label>
                  <p className="text-[11px] text-slate-500">How long to keep event history</p>
                  <select value={form.retentionDays} onChange={e => setForm(p => ({ ...p, retentionDays: parseInt(e.target.value) }))}
                    className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/60 transition-colors">
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>180 days</option>
                    <option value={365}>1 year</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-300">Connectivity check hosts</label>
                  <button type="button" onClick={() => setForm(p => ({ ...p, connectivityHosts: [...p.connectivityHosts, ''] }))}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">IPs to ping for internet checks. Default: 1.1.1.1</p>
                <div className="space-y-2">
                  {(form.connectivityHosts ?? ['1.1.1.1']).map((h, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={h} onChange={e => setForm(p => ({ ...p, connectivityHosts: p.connectivityHosts.map((x, j) => j === i ? e.target.value : x) }))}
                        placeholder="1.1.1.1"
                        className="flex-1 bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors" />
                      {(form.connectivityHosts ?? []).length > 1 && (
                        <button type="button" onClick={() => setForm(p => ({ ...p, connectivityHosts: p.connectivityHosts.filter((_, j) => j !== i) }))} className="text-slate-500 hover:text-red-400 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(2)} className="flex-1 border border-[#1a1a35] text-slate-400 hover:text-slate-200 rounded-xl py-2.5 text-sm transition-colors">
                  Back
                </button>
                <button onClick={() => setStep(4)}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — ISP / SLA */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Wifi className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-base font-bold text-white">ISP / Internet SLA</h2>
                </div>
                <p className="text-xs text-slate-500">Used for uptime SLA reporting and the ISP report export. All fields are optional.</p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className={`block text-xs font-medium ${configOutdated && !form.ispName ? 'text-amber-400' : 'text-slate-300'}`}>ISP Name
                    {configOutdated && !form.ispName && <span className="ml-1.5 text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full">New</span>}
                  </label>
                  <input value={form.ispName} onChange={e => setForm(p => ({ ...p, ispName: e.target.value }))}
                    placeholder="e.g. MetroFibre"
                    className={`w-full rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none transition-colors ${
                      configOutdated && !form.ispName
                        ? 'bg-amber-950/30 border border-amber-500/40 focus:border-amber-400'
                        : 'bg-[#0a0a18] border border-[#1a1a35] focus:border-indigo-500/60'
                    }`} />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Connection Type</label>
                  <select value={form.ispConnectionType} onChange={e => setForm(p => ({ ...p, ispConnectionType: e.target.value }))}
                    className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/60 transition-colors">
                    {['fibre','dsl','lte','cable','satellite','broadband'].map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className={`block text-xs font-medium ${configOutdated && form.ispExpectedUptime === 100 ? 'text-amber-400' : 'text-slate-300'}`}>Expected Uptime %
                    {configOutdated && form.ispExpectedUptime === 100 && <span className="ml-1.5 text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full">New</span>}
                  </label>
                  <p className="text-[11px] text-slate-500">Your ISP's guaranteed uptime (SLA target)</p>
                  <input type="number" min="90" max="100" step="0.001"
                    value={form.ispExpectedUptime}
                    onChange={e => setForm(p => ({ ...p, ispExpectedUptime: e.target.value }))}
                    className={`w-32 rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center focus:outline-none transition-colors ${
                      configOutdated && form.ispExpectedUptime === 100
                        ? 'bg-amber-950/30 border border-amber-500/40 focus:border-amber-400'
                        : 'bg-[#0a0a18] border border-[#1a1a35] focus:border-indigo-500/60'
                    }`} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">Plan Download (Mbps)</label>
                    <input type="number" min="0" max="10000" step="1"
                      value={form.ispPlanDown || ''}
                      onChange={e => setForm(p => ({ ...p, ispPlanDown: e.target.value }))}
                      placeholder="e.g. 250"
                      className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">Plan Upload (Mbps)</label>
                    <input type="number" min="0" max="10000" step="1"
                      value={form.ispPlanUp || ''}
                      onChange={e => setForm(p => ({ ...p, ispPlanUp: e.target.value }))}
                      placeholder="e.g. 50"
                      className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 text-center placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors" />
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(3)} className="flex-1 border border-[#1a1a35] text-slate-400 hover:text-slate-200 rounded-xl py-2.5 text-sm transition-colors">
                  Back
                </button>
                <button onClick={() => setStep(5)}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 5 — Appearance */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Palette className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-base font-bold text-white">Appearance</h2>
                </div>
                <p className="text-xs text-slate-500">Pick a colour theme for the dashboard. You can change this anytime in Settings.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setForm(p => ({ ...p, theme: t.id })); applyTheme(t.id) }}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                      form.theme === t.id
                        ? 'border-indigo-500 bg-indigo-600/10'
                        : 'border-[#1a1a35] hover:border-[#2a2a45]'
                    }`}
                  >
                    <span className="w-8 h-8 rounded-full flex-shrink-0 border border-white/10" style={{ backgroundColor: t.accent }} />
                    <span className="text-xs font-medium text-slate-300 leading-tight text-center">{t.label}</span>
                    <span className="text-[10px] text-slate-500 leading-tight text-center">{t.description}</span>
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(4)} className="flex-1 border border-[#1a1a35] text-slate-400 hover:text-slate-200 rounded-xl py-2.5 text-sm transition-colors">
                  Back
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                  {saving ? 'Saving…' : 'Save & Finish'}
                </button>
              </div>
            </div>
          )}

          {/* Step 6 — Done */}
          {step === 6 && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">All set!</h2>
              <p className="text-sm text-slate-500 mb-8">
                Config saved. Claudette will scan{' '}
                <span className="text-slate-300 font-mono">{form.subnets.filter(s => s.trim()).join(', ')}</span>{' '}
                and monitor your server at{' '}
                <span className="text-slate-300 font-mono">{form.piHost}</span>.
              </p>
              <button
                onClick={onComplete}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
              >
                Start Monitoring
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
