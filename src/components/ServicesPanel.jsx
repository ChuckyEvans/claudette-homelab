import { useState } from 'react'
import { api } from '../lib/api.js'
import { CheckCircle, XCircle, RefreshCw, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function ServiceCard({ result, history = [] }) {
  const [open, setOpen] = useState(false)
  const chartData = history.slice(-30).map((h, i) => ({ i, ms: h.ms }))
  const uptime = history.length
    ? Math.round((history.filter(h => h.ok).length / history.length) * 100)
    : null
  const avgMs = history.length
    ? Math.round(history.reduce((s, h) => s + (h.ms ?? 0), 0) / history.length)
    : null
  const minMs = history.length ? Math.min(...history.map(h => h.ms ?? 0)) : null
  const maxMs = history.length ? Math.max(...history.map(h => h.ms ?? 0)) : null

  return (
    <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl overflow-hidden transition-colors hover:border-[#2a2a45]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left"
      >
        {result.ok
          ? <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-200">{result.name}</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{result.message}</p>
        </div>
        <div className="flex items-center gap-5 text-xs flex-shrink-0">
          {result.ms != null && (
            <Stat label="Now" value={`${result.ms}ms`} />
          )}
          {avgMs != null && <Stat label="Avg" value={`${avgMs}ms`} />}
          {uptime != null && (
            <Stat
              label="Uptime"
              value={`${uptime}%`}
              accent={uptime >= 99 ? 'text-emerald-400' : uptime >= 90 ? 'text-amber-400' : 'text-red-400'}
            />
          )}
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-[#1a1a30] px-5 pb-5">
          {chartData.length > 2 ? (
            <>
              <p className="text-xs text-slate-500 mt-4 mb-3">
                Response time — last {chartData.length} checks
                {minMs != null && ` · min ${minMs}ms / max ${maxMs}ms`}
              </p>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" />
                  <XAxis dataKey="i" hide />
                  <YAxis tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#0f0f20', border: '1px solid #2a2a45', borderRadius: 6, fontSize: 11 }}
                    formatter={v => [`${v}ms`, 'Response']}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="ms"
                    stroke={result.ok ? '#34d399' : '#f87171'}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <p className="text-xs text-slate-500 mt-4">Not enough history yet — checks run every few minutes</p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent = 'text-slate-300' }) {
  return (
    <div className="text-right">
      <p className="text-slate-400">{label}</p>
      <p className={`font-semibold font-mono ${accent}`}>{value}</p>
    </div>
  )
}

export default function ServicesPanel({ services, onRefreshServices }) {
  const { results = [], history = {} } = services
  const okCount = results.filter(r => r.ok).length
  const [refreshing, setRefreshing] = useState(false)
  const [internetModal, setInternetModal] = useState({ open: false, data: null, loading: false })
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const visibleResults = results.filter(r => {
    if (statusFilter === 'up'   && !r.ok) return false
    if (statusFilter === 'down' &&  r.ok) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const [page, setPage] = useState(1)
  const [per, setPer] = useState(10)
  const total = visibleResults.length
  const paged = visibleResults.slice((page - 1) * per, page * per)

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await onRefreshServices() } finally { setRefreshing(false) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Services</h1>
          <p className="text-slate-500 text-sm mt-1">
            {okCount}/{results.length} healthy · click a service for response-time history
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button
          onClick={async () => {
            setInternetModal({ open: true, data: null, loading: true })
            try {
              await api.services.runInternet()
            } catch { /* ignore */ }
            try {
              const res = await api.services.internet()
              setInternetModal({ open: true, data: res, loading: false })
            } catch (e) {
              setInternetModal({ open: true, data: { error: e.message }, loading: false })
            }
          }}
          className="ml-2 flex items-center gap-2 px-3 py-2 bg-[#0f1724] hover:bg-[#0b1220] text-slate-300 rounded-lg text-sm transition-colors"
        >
          More info
        </button>
      </div>

      {results.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-[#2a2a45]">
            {[['all', 'All'], ['up', 'Up'], ['down', 'Down']].map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === val
                    ? val === 'up' ? 'bg-emerald-600/30 text-emerald-400' : val === 'down' ? 'bg-red-600/30 text-red-400' : 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:text-slate-200 bg-[#0f0f20]'
                }`}>
                {label}
                {val === 'up'   && <span className="ml-1 text-[10px] opacity-70">{okCount}</span>}
                {val === 'down' && <span className="ml-1 text-[10px] opacity-70">{results.length - okCount}</span>}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter services…"
              className="bg-[#0a0a18] border border-[#2a2a45] focus:border-indigo-500/50 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none w-48"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {results.length === 0 ? (
          <p className="text-slate-500 text-center py-14">No services configured in config.yaml</p>
        ) : visibleResults.length === 0 ? (
          <p className="text-slate-500 text-center py-10">No services match current filters</p>
        ) : (
          <>
            {paged.map(r => (
              <ServiceCard key={r.name} result={r} history={history[r.name] ?? []} />
            ))}
            {total > per && (
              <div className="mt-3 flex items-center justify-end">
                <label className="text-xs text-slate-400 mr-2">Per page:</label>
                <select value={per} onChange={e => { setPer(Number(e.target.value)); setPage(1) }} className="px-2 py-1 border rounded bg-[#071025] text-sm mr-4">
                  {[5,10,20,50].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <Pagination page={page} total={total} per={per} onChangePage={(p)=>setPage(p)} onChangePer={(n)=>{ setPer(n); setPage(1) }} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Internet modal */}
      {internetModal.open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setInternetModal({ open: false, data: null })}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-[#0d0d1a] border border-[#1a1a35] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a30]">
              <h3 className="text-sm font-semibold text-white">Internet Check — More info</h3>
              <button onClick={() => setInternetModal({ open: false, data: null })} className="text-slate-500 hover:text-slate-300">Close</button>
            </div>
            <div className="p-4 text-sm">
              {internetModal.loading && <p className="text-slate-400">Running checks…</p>}
              {internetModal.data?.error && <p className="text-red-400">Error: {internetModal.data.error}</p>}
              {internetModal.data?.attempts && internetModal.data.attempts.map((attempt, idx) => (
                <div key={idx} className="mb-4">
                  <p className="text-xs text-slate-400 mb-2">Attempt {idx + 1}</p>
                  <div className="rounded-lg overflow-hidden border border-[#1a1a30]">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="bg-[#0a0a18] border-b border-[#1a1a30]">
                          <th className="px-3 py-2 text-left text-slate-500">Host</th>
                          <th className="px-3 py-2 text-center text-slate-500">Status</th>
                          <th className="px-3 py-2 text-right text-slate-500">Latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempt.map((h, i) => (
                          <tr key={i} className="border-b border-[#1a1a30] last:border-0">
                            <td className="px-3 py-2 text-slate-300 font-mono">{h.host}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${h.ok ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>{h.ok ? 'OK' : 'FAIL'}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-400 font-mono">{h.ms != null ? `${h.ms} ms` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
import Pagination from './Pagination.jsx'
