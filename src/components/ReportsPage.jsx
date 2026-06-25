import React, { useEffect, useState } from 'react'
import { useUIPref } from '../lib/uiPrefs.js'
import { api } from '../lib/api.js'
import RetentionPage from './RetentionPage'

export default function ReportsPage() {
  const [events, setEvents] = useState([])
  const [mac, setMac] = useState('')
  const [history, setHistory] = useState([])
  const [liveMonitor, setLiveMonitor] = useState(null)
  const [from, setFrom] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [to, setTo] = useState(() => Date.now())
  const [limit, setLimit] = useUIPref('reports.limit', 50)
  const [offset, setOffset] = useState(0)
  const [tab, setTab] = useUIPref('reports.tab', 'overview')
  const [showRetention, setShowRetention] = useUIPref('reports.showRetention', false)
  const [_chartData, setChartData] = useState(null)
  const [internetStats, setInternetStats] = useState(null)
  const [speedtests, setSpeedtests] = useState(null)
  const [ddnsHistory, setDdnsHistory] = useState(null)

  const loadEvents = React.useCallback(async () => {
    const qs = new URLSearchParams({ from: String(from), to: String(to), limit: String(limit), offset: String(offset) })
    const r = await fetch(`/api/reports?${qs.toString()}`)
    const j = await r.json()
    setEvents(j.events || [])
  }, [from, to, limit, offset])

  useEffect(() => {
    let es
    try {
      es = new EventSource('/api/events')
      es.addEventListener('monitor', e => { try { setLiveMonitor(JSON.parse(e.data)) } catch { void 0 } })
      es.addEventListener('ping_complete', _e => { /* could refresh reports if desired */ })
    } catch { void 0 }
    return () => { try { es?.close() } catch { void 0 } }
  }, [])
    useEffect(() => {
      // Poll monitor probe every 10s
      let mounted = true
      const doPoll = async () => {
        try {
          const resp = await fetch('/api/monitor/probe', { method: 'POST' })
          const j = await resp.json()
          if (mounted) setLiveMonitor(j)
        } catch { void 0 }
      }
      doPoll(); const id = setInterval(doPoll, 10000)
      return () => { mounted = false; clearInterval(id) }
    }, [])

  async function loadReports() {
    const q = await api.reports.get({ limit: 50 })
    setEvents(q.events || [])
  }

  const loadTabData = React.useCallback(async (t) => {
    try {
      const target = t
      if (target === 'overview') {
        const r = await api.reports.get({ limit: 10 })
        setChartData(r)
      } else if (t === 'internet') {
        const r = await api.reports.internet({ limit: 50 })
        setInternetStats(r)
      } else if (t === 'speedtest') {
        const r = await api.reports.speedtest({ limit: 50 })
        setSpeedtests(r)
      } else if (t === 'ddns') {
        const r = await api.ddns.history()
        setDdnsHistory(r)
      }
    } catch (e) { console.error('Load tab', t, e) }
  }, [])

  async function loadHistory() {
    if (!mac) return setHistory([])
    const r = await fetch(`/api/reports/device-ip-history?mac=${encodeURIComponent(mac)}`)
    const j = await r.json()
    setHistory(j.rows || [])
  }
    useEffect(() => { loadEvents() }, [from, to, limit, offset, loadEvents])

  // load reports and current tab data; intentionally mount/when-tab only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadReports(); loadTabData(tab) }, [tab])

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">Reports</h2>
      <div className="mt-4">
        <div className="flex gap-2">
          {['overview','internet','speedtest','ddns','events'].map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded ${tab===t? 'bg-indigo-600 text-white' : 'bg-transparent text-slate-200'}`} title={t === 'incidents' ? 'View security incidents and IP conflicts' : ''}>{t[0].toUpperCase()+t.slice(1)}</button>
            ))}
        </div>
        <div className="mt-2">
          <a href="#retention" onClick={(e)=>{e.preventDefault(); setShowRetention(true)}} className="text-sm text-blue-600">Retention Settings</a>
        </div>
      </div>

      <div className="mt-4">
        <label>Device MAC for IP history</label>
        <input value={mac} onChange={e => setMac(e.target.value)} />
        <button onClick={loadHistory}>Load history</button>
      </div>
      <div className="mt-4">
        <h3>IP History</h3>
        <div className="mt-2 text-xs text-slate-500">Live monitor: {liveMonitor ? `${liveMonitor.ts ? new Date(liveMonitor.ts).toLocaleTimeString() : ''}` : 'no recent' }</div>
        <div className="reports-table-wrapper mt-2">
          <table className="reports-table text-sm">
            <thead><tr><th>ts</th><th>ip</th></tr></thead>
            <tbody>
              {history.map((r,i) => <tr key={i}><td>{new Date(r.ts).toLocaleString()}</td><td>{r.ip}</td></tr>)}
            </tbody>
          </table>
        </div>
        </div>
      {tab === 'overview' && (
        <div className="mt-6">
          <h3>Overview</h3>
          <div className="mt-2 text-sm text-slate-300">Summary and charts (placeholder)</div>
        </div>
      )}

      {tab === 'internet' && (
        <div className="mt-6">
          <h3>Internet</h3>
          <div className="mt-2 text-sm text-slate-300">{internetStats ? JSON.stringify(internetStats).slice(0,400) : 'Loading...'}</div>
        </div>
      )}

      {tab === 'speedtest' && (
        <div className="mt-6">
          <h3>Speedtest</h3>
          <div className="mt-2 text-sm text-slate-300">{speedtests ? JSON.stringify(speedtests).slice(0,400) : 'Loading...'}</div>
        </div>
      )}

      {tab === 'ddns' && (
        <div className="mt-6">
          <h3>DDNS</h3>
          <div className="mt-2 text-sm text-slate-300">{ddnsHistory ? JSON.stringify(ddnsHistory).slice(0,400) : 'Loading...'}</div>
        </div>
      )}

      {/* Incidents were merged into the Dashboard; removed separate view */}

      <div className="mt-4">
          <h3>Events</h3>
          <div className="flex gap-2 items-center mb-2">
            <label className="text-xs">From</label>
            <input type="datetime-local" value={new Date(from).toISOString().slice(0,16)} onChange={e => setFrom(new Date(e.target.value).getTime())} />
            <label className="text-xs">To</label>
            <input type="datetime-local" value={new Date(to).toISOString().slice(0,16)} onChange={e => setTo(new Date(e.target.value).getTime())} />
            <button onClick={() => { setOffset(0); loadEvents() }}>Refresh</button>
          </div>
          <div className="reports-table-wrapper">
            <table className="reports-table text-sm">
              <thead><tr><th>ts</th><th>source</th><th>event</th><th>mac</th><th>ip</th></tr></thead>
              <tbody>
                {events.map((r,i) => <tr key={i}><td>{new Date(r.ts).toLocaleString()}</td><td>{r.source}</td><td>{r.event}</td><td>{r.mac}</td><td>{r.ip}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 items-center mt-2">
            <button onClick={() => { setOffset(Math.max(0, offset - limit)); loadEvents() }}>Prev</button>
            <button onClick={() => { setOffset(offset + limit); loadEvents() }}>Next</button>
            <span className="text-xs ml-2">limit</span>
            <input type="number" value={limit} onChange={e => setLimit(Math.max(1, Math.min(200, parseInt(e.target.value||50,10))))} />
          </div>
        </div>
      {showRetention && (
        <div className="mt-4 bg-white p-4 rounded shadow">
          <button className="text-sm text-gray-500 mb-2" onClick={()=>setShowRetention(false)}>Close</button>
          <RetentionPage />
        </div>
      )}
    </div>
  )
}
