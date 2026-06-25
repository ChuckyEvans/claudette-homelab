import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/api.js'
import { useUIPref } from '../lib/uiPrefs.js'
import { RefreshCw, Search, X, ChevronLeft, ChevronRight, Terminal } from 'lucide-react'

const LEVELS = ['info', 'warn', 'error', 'debug']

const LEVEL_STYLES = {
  info:  { badge: 'bg-sky-500/10  border-sky-500/30  text-sky-300',  dot: 'bg-sky-400'    },
  warn:  { badge: 'bg-amber-500/10 border-amber-500/30 text-amber-300', dot: 'bg-amber-400' },
  error: { badge: 'bg-red-500/10  border-red-500/30  text-red-300',   dot: 'bg-red-400'    },
  debug: { badge: 'bg-slate-500/10 border-slate-500/30 text-slate-400', dot: 'bg-slate-500' },
}

const PAGE_SIZES = [50, 100, 200, 500]

export default function LogsPage() {
  // ── Filter state ────────────────────────────────────────────────────────
  const [selectedLevels, setSelectedLevels] = useUIPref('logs.selectedLevels', ['warn','error'])
  const [search,         setSearch]         = useState('')
  const [searchInput,    setSearchInput]    = useState('')
  const [pageSize,       setPageSize]       = useUIPref('logs.pageSize', 100)
  const [order,          setOrder]          = useUIPref('logs.order', 'desc')   // 'desc' = newest first
  const [page,           setPage]           = useState(1)

  // ── Data state ──────────────────────────────────────────────────────────
  const [data,     setData]     = useState(null)   // { logs, total, page, pageSize, totalPages }
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // ── Auto-refresh ───────────────────────────────────────────────────────
  const [autoRefresh, setAutoRefresh] = useUIPref('logs.autoRefresh', false)
  const [autoInterval, setAutoInterval] = useUIPref('logs.autoInterval', 5000)
  const timerRef = useRef(null)

  // ── Date filters ───────────────────────────────────────────────────────
  const toISODate = (d) => d.toISOString().slice(0,10)
  const today = toISODate(new Date())
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async (resetPage = false) => {
    setLoading(true)
    setError(null)
    try {
      const currentPage = resetPage ? 1 : page
      if (resetPage) setPage(1)
      const result = await api.logs.get({
        levels:   selectedLevels,
        search,
        page:     currentPage,
        pageSize,
        order,
      })
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedLevels, search, page, pageSize, order])

  // Fetch whenever filters change (reset to page 1)
  useEffect(() => {
    fetchLogs(true)
  }, [selectedLevels, search, pageSize, order]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch when page changes (don't reset)
  useEffect(() => {
    if (data !== null) fetchLogs(false)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh with selectable interval
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => fetchLogs(false), autoInterval)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [autoRefresh, autoInterval, fetchLogs])

  // ── Handlers ─────────────────────────────────────────────────────────────
  function toggleLevel(level) {
    setSelectedLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    )
  }

  function handleSearchSubmit(e) {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  function clearSearch() {
    setSearchInput('')
    setSearch('')
  }

  // ── Rendered log row ──────────────────────────────────────────────────────
  function LogRow({ entry }) {
    const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info
    const time  = new Date(entry.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const date  = new Date(entry.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    const copyRow = () => navigator.clipboard.writeText(`${date} ${time} [${entry.level}] ${entry.message}`)
    const saveRow = () => {
      const blob = new Blob([`${date} ${time} [${entry.level}] ${entry.message}\n`], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `log-${entry.seq}.txt`
      a.click()
      URL.revokeObjectURL(url)
    }

    return (
      <div className="flex items-start gap-2 py-1.5 px-3 border-b border-[#1a1a30] hover:bg-[#0d0d20] text-[11px] font-mono">
        <span className="text-slate-400 flex-shrink-0 tabular-nums whitespace-nowrap">{date} {time}</span>
        <span className={`flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase ${style.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {entry.level}
        </span>
        <span className="text-slate-300 whitespace-pre-wrap break-all leading-relaxed">{entry.message}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={copyRow} className="text-[11px] text-slate-500 hover:text-slate-300">Copy</button>
          <button onClick={saveRow} className="text-[11px] text-slate-500 hover:text-slate-300">Save</button>
        </div>
      </div>
    )
  }

  const logs       = data?.logs       ?? []
  const total      = data?.total      ?? 0
  const totalPages = data?.totalPages ?? 1

  function exportLogs(format = 'txt') {
    // Build content from current logs view
    const rows = logs.map(e => `${new Date(e.ts).toISOString()}\t${e.level}\t${e.message}`)
    if (format === 'csv') {
      const csv = ['timestamp,level,message', ...logs.map(e => `"${new Date(e.ts).toISOString()}","${e.level}","${(e.message || '').replace(/"/g,'""')}"`)].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `logs-${dateStart}-${dateEnd}.csv`
      a.click()
      URL.revokeObjectURL(url)
      return
    }
    if (format === 'pdf') {
      import('jspdf').then(({ jsPDF }) => {
        const doc = new jsPDF({ unit: 'mm', format: 'a4' })
        const pageW = 190
        let y = 10
        doc.setFontSize(10)
        doc.text(`Logs ${dateStart} → ${dateEnd}`, 10, y)
        y += 8
        doc.setFontSize(8)
        for (const r of rows) {
          if (y > 285) { doc.addPage(); y = 10 }
          const lines = doc.splitTextToSize(r, pageW)
          doc.text(lines, 10, y)
          y += lines.length * 4.5
        }
        doc.save(`logs-${dateStart}-${dateEnd}.pdf`)
      }).catch(() => alert('Failed to generate PDF'))
      return
    }
    // default txt
    const txt = rows.join('\n')
    const blob = new Blob([txt], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${dateStart}-${dateEnd}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <Terminal className="w-5 h-5 text-indigo-400 flex-shrink-0" />
        <div>
          <h1 className="text-base font-semibold text-slate-200">Logs</h1>
          <p className="text-xs text-slate-500">Live server console output — last 5,000 lines retained in memory</p>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="bg-[#0d0d1f] border border-[#1a1a30] rounded-xl p-3 flex flex-wrap items-center gap-3">

        {/* Level checkboxes */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide mr-1">Level</span>
          {LEVELS.map(level => {
            const active = selectedLevels.includes(level)
            const style  = LEVEL_STYLES[level]
            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium uppercase transition-all ${
                  active
                    ? style.badge
                    : 'bg-transparent border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500'
                }`}
              >
                {active && <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />}
                {level}
              </button>
            )
          })}
        </div>

        {/* Divider */}
        <span className="w-px h-5 bg-[#1a1a30] hidden sm:block" />

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Filter message…"
              className="bg-[#080812] border border-[#1a1a30] rounded-lg pl-6 pr-6 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 w-48"
            />
            {searchInput && (
              <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button type="submit" className="px-2.5 py-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs hover:bg-indigo-600/30 transition-colors">
            Search
          </button>
          {search && search !== searchInput && (
            <span className="text-[10px] text-amber-400">↵ enter to apply</span>
          )}
        </form>

        {/* Divider */}
        <span className="w-px h-5 bg-[#1a1a30] hidden sm:block" />

        {/* Date filters */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">From</span>
          <input type="date" value={dateStart} onChange={e=>{setDateStart(e.target.value); setPage(1)}} className="bg-[#080812] border border-[#1a1a30] rounded-lg px-2 py-1 text-xs text-slate-300" />
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">To</span>
          <input type="date" value={dateEnd} onChange={e=>{setDateEnd(e.target.value); setPage(1)}} className="bg-[#080812] border border-[#1a1a30] rounded-lg px-2 py-1 text-xs text-slate-300" />
        </div>

        {/* Order toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Order</span>
          <select
            value={order}
            onChange={e => setOrder(e.target.value)}
            className="bg-[#080812] border border-[#1a1a30] rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="asc">Oldest first</option>
            <option value="desc">Newest first</option>
          </select>
        </div>

        {/* Page size */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Per page</span>
          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            className="bg-[#080812] border border-[#1a1a30] rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
          >
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Divider */}
        <span className="w-px h-5 bg-[#1a1a30] hidden sm:block" />

        {/* Auto-refresh toggle */}
        <div className="flex items-center gap-2">
        <button
          onClick={() => setAutoRefresh(v => !v)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors ${
            autoRefresh
              ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-300'
              : 'bg-transparent border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40'
          }`}
        >
          <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} style={autoRefresh ? { animationDuration: '3s' } : {}} />
          Auto
        </button>
        <select value={autoInterval} onChange={e=>setAutoInterval(Number(e.target.value))} className="bg-[#080812] border border-[#1a1a30] rounded-lg px-2 py-1 text-xs text-slate-300">
          <option value={30000}>30s</option>
          <option value={20000}>20s</option>
          <option value={10000}>10s</option>
          <option value={5000}>5s</option>
          <option value={1000}>1s</option>
        </select>
        </div>

        {/* Manual refresh */}
        <button
          onClick={() => fetchLogs(false)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40 text-xs transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {/* Result count */}
        <span className="ml-auto text-[10px] text-slate-500 tabular-nums">
          {total.toLocaleString()} result{total !== 1 ? 's' : ''}
          {search && <span className="text-amber-500/80"> · filtered</span>}
        </span>
        {/* Exports */}
        <div className="ml-3 flex items-center gap-2">
          <button onClick={() => exportLogs('txt')} className="px-2 py-1 rounded-lg border border-[#1a1a30] text-xs text-slate-500">Export TXT</button>
          <button onClick={() => exportLogs('csv')} className="px-2 py-1 rounded-lg border border-[#1a1a30] text-xs text-slate-500">Export CSV</button>
          <button onClick={() => exportLogs('pdf')} className="px-2 py-1 rounded-lg border border-[#1a1a30] text-xs text-slate-500">Export PDF</button>
        </div>
      </div>

      {/* ── Log output ── */}
      <div className="bg-[#080810] border border-[#1a1a30] rounded-xl overflow-hidden">
        {error ? (
          <div className="p-6 text-center text-red-400 text-sm">{error}</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            {loading ? 'Loading…' : 'No log entries match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {logs.map(entry => <LogRow key={entry.seq} entry={entry} />)}
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Page {page} of {totalPages} · {total.toLocaleString()} total entries
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="px-2 py-1 rounded-lg border border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40 text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ««
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {/* Page number pills */}
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p
              if (totalPages <= 7) {
                p = i + 1
              } else if (page <= 4) {
                p = i + 1
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i
              } else {
                p = page - 3 + i
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] tabular-nums transition-colors ${
                    p === page
                      ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                      : 'border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40'
                  }`}
                >
                  {p}
                </button>
              )
            })}

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg border border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="px-2 py-1 rounded-lg border border-[#1a1a30] text-slate-500 hover:text-slate-300 hover:border-slate-500/40 text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              »»
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
