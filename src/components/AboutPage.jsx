import { Wand2, RefreshCw, CheckCircle, XCircle, ExternalLink, Shield, Network, Activity, Cpu, ClipboardList, Tv } from 'lucide-react'
import ClaudetteLogo from './ClaudetteLogo.jsx'

const FEATURES = [
  { icon: Network,      label: 'Network Scanner',     desc: 'Discovers devices on your subnet via nmap. Tracks online/offline status and persists to SQLite.' },
  { icon: Activity,     label: 'Service Monitor',     desc: 'HTTP and Docker health checks with live status, response times, and failure history.' },
  { icon: Shield,       label: 'Threat Feed',         desc: 'Polls CVE and advisory RSS feeds, grouped by package with severity badges.' },
  { icon: Cpu,          label: 'System Stats',        desc: 'CPU, RAM, disk, and network usage via systeminformation.' },
  { icon: ClipboardList,label: 'Audit Log',           desc: 'Timestamped record of every scan, config change, and system event.' },
  { icon: Tv,           label: 'Kodi Addon',          desc: 'Full LibreELEC/Kodi client in output/kodi/ — browse devices, threats, and services from your TV.' },
]

const STACK = [
  { label: 'Runtime',   value: 'Node.js 20 + Express 4' },
  { label: 'Frontend',  value: 'React 18 + Vite 5 + Tailwind 3' },
  { label: 'Database',  value: 'SQLite (node-sqlite3-wasm)' },
  { label: 'Scanner',   value: 'nmap 7.80' },
  { label: 'Port',      value: '7654 (API)  ·  5173 (dev UI)' },
]

export default function AboutPage({ onShowWizard, updateInfo, onCheckUpdates, checkingUpdate = false }) {
  const versionInfo = updateInfo ?? null
  const displayVersion = versionInfo?.current ?? '0.2.2'
  const buildTime = versionInfo?.build_time ?? null

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">

      {/* Hero */}
      <div className="flex items-center gap-4">
        <ClaudetteLogo className="w-14 h-14 flex-shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Claudette</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Homelab Monitor
            {` · v${displayVersion}`}{buildTime ? ` · built ${new Date(buildTime).toLocaleString()}` : ''}
          </p>
        </div>
      </div>

      <p className="text-slate-400 text-sm leading-relaxed">
        A self-hosted dashboard for your homelab — scans your network, watches your services, surfaces security advisories, and keeps a full audit trail. Runs entirely on your LAN; no cloud account required.
      </p>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={onShowWizard}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Wand2 className="w-4 h-4" />
          Setup Wizard
        </button>

        <button
          disabled={checkingUpdate}
          onClick={() => onCheckUpdates(true)}
          className="flex items-center gap-2 bg-[#0f0f1e] hover:bg-[#1a1a30] border border-[#1a1a30] hover:border-indigo-500/40 text-slate-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
          {checkingUpdate ? 'Checking…' : 'Check for Updates'}
        </button>

        {/* Update status badge */}
        {!checkingUpdate && versionInfo && (
          versionInfo.updateAvailable ? (
            <a
              href={versionInfo.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 text-sm transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              v{versionInfo.latest} available on GitHub
            </a>
          ) : versionInfo.error ? (
            <span className="flex items-center gap-1.5 text-slate-500 text-sm">
              <XCircle className="w-4 h-4" /> Couldn&apos;t reach GitHub
            </span>
          ) : versionInfo.latest ? (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4" /> You&apos;re up to date
            </span>
          ) : null
        )}
      </div>

      {/* Features */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-indigo-400">
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium text-slate-200">{label}</span>
              </div>
              <p className="text-[12px] text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech stack */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Tech Stack</h2>
        <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl divide-y divide-[#1a1a30]">
          {STACK.map(({ label, value }) => (
            <div key={label} className="flex items-center px-4 py-3 gap-4">
              <span className="text-xs text-slate-400 w-24 flex-shrink-0">{label}</span>
              <span className="text-sm text-slate-300 font-mono">{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Config location */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Data Files</h2>
        <div className="bg-[#0a0a18] border border-[#1a1a30] rounded-xl divide-y divide-[#1a1a30]">
          {[
            { label: 'Config',    value: 'config.yaml' },
            { label: 'Database',  value: 'data/claudette.db' },
            { label: 'State',     value: 'data/state.json' },
            { label: 'Kodi addon',value: 'output/kodi/plugin.program.claudette/' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center px-4 py-3 gap-4">
              <span className="text-xs text-slate-400 w-24 flex-shrink-0">{label}</span>
              <span className="text-[12px] text-slate-400 font-mono">{value}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
