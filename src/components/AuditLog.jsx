import { useState, useEffect, useCallback } from 'react'
import { ClipboardList, RefreshCw, Filter, Eraser, Search } from 'lucide-react'
import { api } from '../lib/api.js'
import Pagination from './Pagination.jsx'

const EVENT_FILTERS = [
  { label: 'All',      value: '' },
  { label: 'Scans',    value: 'scan' },
  { label: 'Services', value: 'service' },
  { label: 'Threats',  value: 'threat' },
  { label: 'Config',   value: 'config' },
]

const EVENT_COLORS = {
  'scan.complete':  'text-indigo-400  bg-indigo-500/10',
  'scan.started':   'text-indigo-300  bg-indigo-500/10',
  'scan.error':     'text-red-400     bg-red-500/10',
  'service.check':  'text-slate-400   bg-white/5',
  'service.down':   'text-red-400     bg-red-500/10',
  'service.up':     'text-emerald-400 bg-emerald-500/10',
  'threat.refresh': 'text-amber-400   bg-amber-500/10',
  'config.saved':   'text-sky-400     bg-sky-500/10',
}

function eventColor(event) {
  return EVENT_COLORS[event] ?? 'text-slate-400 bg-white/5'
}

function fmtDuration(payload) {
  if (!payload?.durationMs) return null
  const s = payload.durationMs / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`
}

function PayloadSummary({ payload }) {
  if (!payload || Object.keys(payload).length === 0) return null
  const parts = []
  if (payload.devices_found != null) parts.push(`${payload.devices_found} devices`)
  if (payload.subnet)                parts.push(payload.subnet)
  if (payload.up != null)            parts.push(`${payload.up} up / ${payload.down} down`)
  if (payload.new_count != null)     parts.push(`${payload.new_count} new`)
  if (payload.name)                  parts.push(payload.name)
  if (payload.piHost)                parts.push(payload.piHost)
  if (payload.error)                 parts.push(payload.error)
  if (parts.length === 0) parts.push(JSON.stringify(payload).slice(0, 80))
  return <span className="text-slate-400 text-xs">{parts.join(' · ')}</span>
}

const PAGE_SIZE = 50

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function AuditLog() {
  const [data, setData]           = useState({ entries: [], total: 0, newestTs: null, oldestTs: null })
  const [filter, setFilter]       = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]       = useState('')
  const [offset, setOffset]       = useState(0)
  const [loading, setLoading]     = useState(false)
  const [lastChecked, setLastChecked] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(() => {
    setLoading(true)
    api.audit.get({ event: filter || undefined, q: search || undefined, limit: PAGE_SIZE, offset })
      .then(d => { setData(d); setLastChecked(Date.now()) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filter, search, offset])

  useEffect(() => { load() }, [load])

  const changeFilter = (val) => { setFilter(val); setOffset(0) }

  const handleClear = async () => {
    if (!window.confirm('Clear the audit log? All recorded events will be removed.')) return
    await api.audit.clear()
    setOffset(0)
    load()
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a30] flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Audit Log</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            {data.total.toLocaleString()} events recorded
          </p>
          <div className="flex gap-4 mt-1.5">
            <span className="text-[11px] text-slate-400">
              <span className="text-slate-400">Created:</span> {fmtDate(data.oldestTs)}
            </span>
            <span className="text-[11px] text-slate-400">
              <span className="text-slate-400">Last updated:</span> {fmtDate(data.newestTs)}
            </span>
            <span className="text-[11px] text-slate-400">
              <span className="text-slate-400">Last checked:</span> {fmtDate(lastChecked)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-3 py-2 text-red-500/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg text-xs transition-colors"
          >
            <Eraser className="w-3.5 h-3.5" />
            Clear
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-200 border border-[#1a1a30] hover:border-[#2a2a45] rounded-lg text-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[#1a1a30] flex-shrink-0 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        {EVENT_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => changeFilter(f.value)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f.value
                ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1 min-w-[180px] max-w-xs ml-auto relative">
          <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); setOffset(0) }}
            placeholder="Search events, IP, actor…"
            className="w-full bg-[#0a0a18] border border-[#1a1a30] focus:border-indigo-500/50 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {data.entries.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <ClipboardList className="w-10 h-10 text-indigo-400/20 mb-3" />
            <p className="text-sm text-slate-400">No audit events yet</p>
            <p className="text-xs text-slate-400 mt-1">Events are recorded as Claudette runs</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#0d0d1a]">
              <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-[#1a1a30]">
                <th className="text-left px-6 py-2 w-40">Time</th>
                <th className="text-left px-4 py-2 w-44">Event</th>
                <th className="text-left px-4 py-2 w-20">Actor</th>
                <th className="text-left px-4 py-2 w-24">Duration</th>
                <th className="text-left px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0f0f1a]">
              {data.entries.map(row => (
                <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-2.5 font-mono text-slate-400 whitespace-nowrap">
                    {new Date(row.ts).toLocaleString('en-GB')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium ${eventColor(row.event)}`}>
                      {row.event}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{row.actor}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums whitespace-nowrap text-slate-400">
                    {fmtDuration(row.payload) ?? <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <PayloadSummary payload={row.payload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#1a1a30] flex-shrink-0">
          <span className="text-xs text-slate-400">
            Page {currentPage} of {totalPages} · {data.total.toLocaleString()} total
          </span>
          <Pagination page={currentPage - 1} totalPages={totalPages} onPage={p => setOffset(p * PAGE_SIZE)} />
        </div>
      )}
    </div>
  )
}
