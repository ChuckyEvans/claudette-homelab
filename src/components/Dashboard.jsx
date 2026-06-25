import { CheckCircle, XCircle, Shield, Activity, Server, AlertTriangle, ArrowRight } from 'lucide-react'
// no hooks required here
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'

function StatCard({ title, value, sub, icon: Icon, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`bg-[#0f0f20] border border-[#1a1a30] rounded-xl p-5 text-left transition-all hover:border-[#2a2a45] hover:bg-[#131325] ${onClick ? 'cursor-pointer' : 'cursor-default'} group`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{title}</p>
          <p className={`text-3xl font-bold mt-1.5 ${accent}`}>{value}</p>
          {sub && <p className="text-slate-400 text-xs mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg bg-[#1a1a35] flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${accent}`} />
        </div>
      </div>
      {onClick && (
          <div className="mt-3 flex items-center gap-1 text-xs text-slate-400 group-hover:text-slate-300 transition-colors">
          View <ArrowRight className="w-3 h-3" />
        </div>
      )}
    </button>
  )
}

function ServiceRow({ result, history = [] }) {
  const chartData = history.slice(-15).map((h, i) => ({ i, ms: h.ms }))
  const uptime = history.length
    ? Math.round((history.filter(h => h.ok).length / history.length) * 100)
    : null

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${result.ok ? 'bg-emerald-400' : 'bg-red-400'}`} title={result.ok ? 'Service OK' : 'Service failing'} />
      <span className="flex-1 text-sm text-slate-300 font-medium truncate">{result.name}</span>
      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
        result.ok ? 'bg-emerald-950/80 text-emerald-400' : 'bg-red-950/80 text-red-400'
      }`}>
        {result.ok ? 'OK' : 'FAIL'}
      </span>
      {result.ms != null && (
        <span className="text-xs text-slate-400 font-mono w-14 text-right">{result.ms}ms</span>
      )}
      {uptime != null && (
        <span className="text-xs text-slate-400 w-12 text-right">{uptime}%</span>
      )}
      <div className="w-20 h-7 flex-shrink-0">
        {chartData.length > 2 && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <Line
                type="monotone"
                dataKey="ms"
                stroke={result.ok ? '#34d399' : '#f87171'}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#0f0f20',
                  border: '1px solid #2a2a45',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '2px 8px',
                }}
                labelStyle={{ display: 'none' }}
                formatter={v => [`${v}ms`]}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function Dashboard({ services, threats, systemStats, setPage }) {
  const results = services?.results ?? []
  const history = services?.history ?? {}
  const okCount = results.filter(r => r.ok).length
  const failCount = results.filter(r => !r.ok).length
  const threatCount = threats?.threats?.length ?? 0

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Live overview · auto-refreshing</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          title="Services"
          value={`${okCount} / ${results.length}`}
          sub={results.length ? `${Math.round((okCount / results.length) * 100)}% healthy` : 'No services'}
          icon={CheckCircle}
          accent={failCount === 0 ? 'text-emerald-400' : 'text-amber-400'}
          onClick={() => setPage('services')}
        />
        <StatCard
          title="Failing"
          value={failCount}
          sub={failCount === 0 ? 'All clear' : 'Needs attention'}
          icon={XCircle}
          accent={failCount === 0 ? 'text-slate-500' : 'text-red-400'}
          onClick={failCount > 0 ? () => setPage('services') : undefined}
        />
        <StatCard
          title="Threats"
          value={threatCount}
          sub={threatCount > 0 ? 'Review feed' : 'No new threats'}
          icon={Shield}
          accent={threatCount > 0 ? 'text-amber-400' : 'text-slate-500'}
          onClick={() => setPage('threats')}
        />
        {systemStats ? (
          <StatCard
            title="CPU"
            value={`${systemStats.cpu?.load ?? 0}%`}
            sub={systemStats.os?.hostname ?? ''}
            icon={Activity}
            accent={
              (systemStats.cpu?.load ?? 0) > 80
                ? 'text-red-400'
                : (systemStats.cpu?.load ?? 0) > 50
                ? 'text-amber-400'
                : 'text-indigo-400'
            }
            onClick={() => setPage('system')}
          />
        ) : (
          <StatCard title="CPU" value="—" sub="Loading…" icon={Activity} accent="text-slate-500" />
        )}
      </div>

      {/* System quick stats */}
      {systemStats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Memory', value: `${systemStats.memory?.percent ?? 0}%`, sub: `${fmtBytes(systemStats.memory?.used)} / ${fmtBytes(systemStats.memory?.total)}` },
            { label: 'Uptime', value: formatUptime(systemStats.os?.uptime ?? 0), sub: `${systemStats.os?.distro} ${systemStats.os?.release}` },
            { label: 'Disk (root)', value: `${systemStats.disk?.find(d => d.mount === '/')?.use ?? '—'}%`, sub: systemStats.disk?.find(d => d.mount === '/')?.fs ?? '' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl px-5 py-4">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
              <p className="text-xl font-bold text-slate-200 mt-1">{value}</p>
              <p className="text-slate-400 text-xs mt-0.5 truncate">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Services list */}
      <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1a1a30] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-400" />
            Services
          </h2>
          <span className="text-xs text-slate-400">live updates via SSE</span>
        </div>
        <div className="divide-y divide-[#131325]">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-slate-400 text-sm text-center">No services in config.yaml</p>
          ) : (
            results.map(r => (
              <ServiceRow key={r.name} result={r} history={history[r.name]} />
            ))
          )}
        </div>
      </div>

      {/* Recent threats */}
      {threatCount > 0 && (
        <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1a1a30] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Recent Threats
            </h2>
            <button onClick={() => setPage('threats')} className="text-xs text-indigo-400 hover:text-indigo-300">
              View all
            </button>
          </div>
          <div className="divide-y divide-[#131325]">
            {threats.threats.slice(0, 4).map(t => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <SeverityBadge severity={t.severity} />
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-300 hover:text-white truncate flex-1"
                >
                  {t.title}
                </a>
                <span className="text-xs text-slate-400 flex-shrink-0">{t.source.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incidents removed — dashboard contains summary cards now */}
    </div>
  )
}

function SeverityBadge({ severity }) {
  const map = {
    critical: 'bg-red-950/80 text-red-400',
    high:     'bg-orange-950/80 text-orange-400',
    medium:   'bg-amber-950/80 text-amber-400',
    low:      'bg-blue-950/80 text-blue-400',
  }
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${map[severity] ?? map.low}`}>
      {severity}
    </span>
  )
}

function fmtBytes(b) {
  if (!b) return '0 B'
  const k = 1024
  const sz = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sz[i]}`
}
