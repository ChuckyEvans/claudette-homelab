import { useState, useEffect } from 'react'
import ReportsIPClashes from './ReportsIPClashes'

export default function Incidents() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/incidents')
      const j = await r.json()
      setData(j)
    } catch (e) { setData({ error: e.message }) }
    finally { setLoading(false) }
  }

  if (loading) return <div className="p-6 text-slate-300">Loading incidents…</div>
  if (!data) return <div className="p-6 text-slate-300">No data</div>
  if (data.error) return <div className="p-6 text-red-400">Error: {data.error}</div>

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Incidents</h2>
          <p className="text-sm text-slate-400">Merged view: IP clashes and detected suspicious activity.</p>
        </div>
        <div className="text-sm text-slate-500">Total clashes: {data.clashes?.length ?? 0}</div>
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-semibold">Detectors</h3>
        <div className="mt-2 text-xs text-slate-400">Port scans: {data.portScans?.length ?? 0}, Beacons: {data.beacons?.length ?? 0}</div>
      </div>

      <div className="mb-6">
        <ReportsIPClashes />
      </div>
    </div>
  )
}
