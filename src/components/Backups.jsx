import { useEffect, useState, useRef } from 'react'
import { api } from '../lib/api.js'

export default function Backups({ setPage: _setPage, addToast }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirming, setConfirming] = useState(null) // { file }
  const fileRef = useRef()

  const load = () => {
    setLoading(true)
    api.system.backups().then(r => setItems(r.items || [])).catch(() => setItems([])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    try {
      await api.system.backup()
      addToast?.('Backup created and downloaded', 'update')
      setTimeout(load, 1000)
    } catch (e) {
      addToast?.('Backup failed: ' + e.message, 'update')
    }
  }

  const onFilePicked = (ev) => {
    const f = ev.target.files?.[0]
    if (!f) return
    setConfirming({ file: f })
  }

  const doRestore = async () => {
    if (!confirming?.file) return
    setRestoring(true)
    try {
      const buf = await confirming.file.arrayBuffer()
      await api.system.restore(buf)
      addToast?.('Restore completed — reloading', 'update')
      window.location.reload()
    } catch (e) {
      addToast?.('Restore failed: ' + e.message, 'update')
    } finally {
      setRestoring(false)
      setConfirming(null)
      fileRef.current.value = ''
    }
  }

  const cancelConfirm = () => {
    setConfirming(null)
    fileRef.current.value = ''
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Backups</h1>
        <div className="flex items-center gap-2">
          <button onClick={handleCreate} className="px-3 py-1.5 bg-indigo-600 text-white rounded">Create & Download</button>
          <label className="px-3 py-1.5 bg-slate-800 text-slate-200 rounded cursor-pointer">
            {restoring ? 'Restoring...' : 'Restore from file'}
            <input ref={fileRef} type="file" accept=".gz,.claudette" onChange={onFilePicked} className="hidden" />
          </label>
          <button onClick={load} className="px-3 py-1.5 bg-white/3 text-white rounded">Refresh</button>
        </div>
      </div>

      <div className="bg-[#0b0b18] border border-[#1a1a30] rounded-lg p-4">
        <p className="text-sm text-slate-400 mb-3">Available backups (newest first). Auto-backups are created per schedule.</p>
        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">No backups found.</div>
        ) : (
          <div className="space-y-2">
            {items.map(it => (
              <div key={it.name} className="flex items-center justify-between bg-[#07071a] border border-[#1a1a30] rounded px-3 py-2">
                <div>
                  <div className="text-sm text-slate-200">{it.name}</div>
                  <div className="text-xs text-slate-500">{(it.size/1024).toFixed(1)} KB • {new Date(it.mtime).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <a className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded" href={`/api/system/backup?name=${encodeURIComponent(it.name)}`} target="_blank" rel="noreferrer">Download</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#0d0d1e] border border-[#1a1a30] rounded-xl p-6 w-full max-w-lg mx-4">
            <h2 className="text-base font-semibold text-white mb-2">Confirm Restore</h2>
            <p className="text-sm text-slate-400 mb-4">You are about to restore from <strong className="text-slate-200">{confirming.file.name}</strong>. This will overwrite the current database and configuration. A pre-restore snapshot will be kept automatically by the server.</p>
            <div className="flex justify-end gap-2">
              <button onClick={cancelConfirm} className="px-3 py-1.5 bg-white/3 text-white rounded">Cancel</button>
              <button onClick={doRestore} disabled={restoring} className="px-3 py-1.5 bg-red-600 text-white rounded">{restoring ? 'Restoring…' : 'Proceed & Restore'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
