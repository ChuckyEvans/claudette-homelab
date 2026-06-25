import React, { useEffect, useState } from 'react'
import api from '../lib/api'

export default function RetentionWarning() {
  const [show, setShow] = useState(false)
  const [info, setInfo] = useState(null)

  useEffect(() => {
    async function check() {
      try {
        const res = await api.get('/api/retention/info')
        const data = await res.json()
        setInfo(data)
        const prevention = localStorage.getItem('retention.prevent')
        if (prevention === 'true') return
        // show if retentionUntil is within 7 days
        const until = data.retentionUntil ? new Date(data.retentionUntil) : new Date(Date.now() + 365*24*60*60*1000)
        const now = new Date()
        const diff = until.getTime() - now.getTime()
        const oneWeek = 7 * 24 * 60 * 60 * 1000
        if (diff > oneWeek) return
        const lastShown = localStorage.getItem('retention.lastShown')
        const last = lastShown ? parseInt(lastShown,10) : 0
        if (Date.now() - last < 24*60*60*1000) return
        setShow(true)
        localStorage.setItem('retention.lastShown', String(Date.now()))
      } catch {
        // ignore
      }
    }
    check()
  }, [])

  if (!show || !info) return null

  const handleOk = () => {
    setShow(false)
  }
  const handlePrevent = async () => {
    localStorage.setItem('retention.prevent','true')
    try { await api.post('/api/retention/prevent') } catch { void 0 }
    setShow(false)
  }
  const handleChange = async () => {
    const v = parseInt(prompt('Set retention days', String(info.retentionDays || 365)),10)
    if (Number.isInteger(v)) {
      await api.post('/api/retention/update', { days: v })
      setShow(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded shadow-lg w-11/12 md:w-1/2">
        <h3 className="text-lg font-bold">Retention Notice</h3>
        <p className="mt-2">One week before purge: Data older than {info.retentionDays} days will be purged from the following tables:</p>
        <ul className="list-disc list-inside mt-2">
          {info.tables.map(t => <li key={t}>{t}</li>)}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-1 bg-gray-200 rounded" onClick={handleChange}>Change</button>
          <button className="px-3 py-1 bg-red-500 text-white rounded" onClick={handlePrevent}>Prevent</button>
          <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  )
}
