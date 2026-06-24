import React, { useEffect, useState, useRef } from 'react'
import ReportsIPClashes from './ReportsIPClashes'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

export default function Incidents() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('first_seen')
  const [age, setAge] = useState('7')
  const [page, setPage] = useState(0)
  const containerRef = useRef(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams({ filter, sort, age, page })
        const r = await fetch(`/api/incidents?${qs.toString()}`)
        const j = await r.json()
        setData(j)
      } catch (err) { setData({ error: err.message }) }
      finally { setLoading(false) }
    }
    load()
  }, [filter, sort, age, page])

  useEffect(() => {
    // persist UI prefs in a cookie forever
    const prefs = { filter, sort, age, page }
    document.cookie = `incidents_prefs=${encodeURIComponent(JSON.stringify(prefs))}; path=/; SameSite=Lax`
  }, [filter, sort, age, page])

  useEffect(() => {
    // restore prefs from cookie
    const m = document.cookie.match(/(?:^|; )incidents_prefs=([^;]+)/)
    if (m) {
      try {
        const p = JSON.parse(decodeURIComponent(m[1]))
        if (p.filter) setFilter(p.filter)
        if (p.sort) setSort(p.sort)
        if (p.age) setAge(p.age)
        if (p.page) setPage(Number(p.page))
      } catch {
        // ignore
      }
    }
  }, [])

  const exportCsv = () => {
    if (!data) return
    const rows = []
    (data.persisted || []).forEach((r) => rows.push([r.type, r.key, r.count, r.first_seen, r.last_seen]))
    const csv = ['Type,Key,Count,FirstSeen,LastSeen', ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'incidents.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportPdf = async () => {
    if (!containerRef.current) return
    const canvas = await html2canvas(containerRef.current)
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('landscape')
    const imgProps = pdf.getImageProperties(imgData)
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
    pdf.save('incidents.pdf')
  }

  if (loading) return <div className="p-6 text-slate-300">Loading incidents…</div>
  if (!data) return <div className="p-6 text-slate-300">No data</div>
  if (data.error) return <div className="p-6 text-red-400">Error: {data.error}</div>

  return (
    <div className="p-4" ref={containerRef}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Incidents</h2>
          <p className="text-sm text-slate-400">Merged view: IP clashes and detected suspicious activity.</p>
        </div>
        <div className="text-sm text-slate-500">Total clashes: {data.clashes?.length ?? 0}</div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs">Filter:
          <select className="ml-2" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="ip-clash">IP Clashes</option>
            <option value="port-scan">Port Scans</option>
            <option value="beacon">Beacons</option>
          </select>
        </label>
        <label className="text-xs">Sort:
          <select className="ml-2" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="first_seen">First Seen</option>
            <option value="last_seen">Last Seen</option>
            <option value="count">Count</option>
          </select>
        </label>
        <label className="text-xs">Age(days):
          <input className="ml-2 w-16" value={age} onChange={(e) => setAge(e.target.value)} />
        </label>
        <button className="ml-auto btn" onClick={exportCsv}>Export CSV</button>
        <button className="btn" onClick={exportPdf}>Export PDF</button>
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-semibold">Detectors</h3>
        <div className="mt-2 text-xs text-slate-400">Port scans: {data.portScans?.length ?? 0}, Beacons: {data.beacons?.length ?? 0}</div>
      </div>

      <div className="mb-6">
        <ReportsIPClashes />
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Persisted Alerts</h3>
        <div className="mt-2 text-xs text-slate-400">Showing {data.persisted?.length ?? 0} alerts</div>
        <div className="mt-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th>Type</th><th>Key</th><th>Count</th><th>First</th><th>Last</th></tr>
            </thead>
            <tbody>
              {(data.persisted || []).map((r) => (
                <tr key={`${r.type}-${r.key}`} className="border-t"><td>{r.type}</td><td>{r.key}</td><td>{r.count}</td><td>{r.first_seen}</td><td>{r.last_seen}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
