import React, { useEffect, useState } from 'react'
import api from '../lib/api'

export default function RetentionPage() {
  const [info, setInfo] = useState(null)
  const [until, setUntil] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function load() {
      const res = await api.get('/api/retention/info')
      const data = await res.json()
      setInfo(data)
      const def = data.retentionUntil || new Date(Date.now() + 365*24*60*60*1000).toISOString().slice(0,10)
      setUntil(def.slice(0,10))
    }
    load()
  }, [])

  const save = async () => {
    if (!until) return alert('Invalid date')
    setLoading(true)
    try {
      await api.post('/api/retention/update', { until: new Date(until).toISOString() })
      alert('Updated')
    } catch (e) {
      alert('Failed to update: ' + (e?.message || String(e)))
    } finally {
      setLoading(false)
    }
  }

  if (!info) return <div>Loading...</div>

  return (
    <div>
      <h2 className="text-xl font-bold">Retention Settings</h2>
      <p className="mt-2">Current retention: <strong>{info.retentionDays} days</strong></p>
      {info.backupDoneFor ? (
        <p className="mt-2 text-sm text-green-600">Backup created for retention date: {new Date(info.backupDoneFor).toLocaleString()}</p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No pre-purge backup recorded yet.</p>
      )}
      <label className="block mt-4">Change retention until (date):
        <input type="date" className="ml-2 border px-2" value={until} onChange={e => setUntil(e.target.value)} />
      </label>
        <div className="mt-4">
        <button disabled={loading} className={`px-3 py-1 rounded ${loading ? 'bg-gray-400 text-gray-700' : 'bg-blue-600 text-white'}`} onClick={save}>
          {loading ? 'Saving...' : 'Save'}
        </button>
      </div>
      <h3 className="mt-6 font-semibold">Tables to be purged</h3>
      <ul className="list-disc list-inside mt-2">
        {info.tables.map(t => <li key={t}>{t}</li>)}
      </ul>
    </div>
  )
}
