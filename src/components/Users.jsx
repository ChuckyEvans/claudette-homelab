import React, { useEffect, useState, useCallback } from 'react'

function Users() {
  // lightweight toast stack (same pattern used in Reports)
  const [toasts, setToasts] = useState([])
  const addToast = useCallback((message, type='success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const [users, setUsers] = useState([])
  const [page, setPage] = useState(1)
  const [per, setPer] = useState(20)
  const [q, setQ] = useState('')
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPage() }, [page, q])

  useEffect(() => { // fetch current user role
    fetch('/api/auth/me').then(r => {
      if (!r.ok) return setIsAdmin(false)
      return r.json().then(j => setIsAdmin(j.role === 'admin'))
    }).catch(() => setIsAdmin(false))
  }, [])

  async function fetchPage(p = page, pageSize = per) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per: pageSize, q })
      const res = await fetch('/api/users?' + params.toString())
      const json = await res.json()
      setUsers(json.items || [])
      setTotal(json.total || 0)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function promote(username) {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/promote`, { method: 'POST' })
      if (!res.ok) throw new Error('Promote failed')
      addToast(`Promoted ${username}`)
      fetchPage()
    } catch (e) { addToast(e.message || 'Promote failed', 'error') }
  }

  async function removeUser(username) {
    // show modal confirmation instead of browser confirm
    setConfirmDelete({ show: true, username })
  }

  async function editUser(username, isSelf=false) {
    // open modal for editing
    setEditModal({ show: true, username, isSelf, role: (users.find(u=>u.username===username)?.role) || 'user', changePassword: false, oldPassword: '', newPassword: '' })
  }

  const [editModal, setEditModal] = useState({ show: false })
  const [createModal, setCreateModal] = useState({ show: false, username: '', password: '', role: 'user' })
  const [confirmDelete, setConfirmDelete] = useState({ show: false, username: null })

  async function submitEditModal(ev) {
    ev.preventDefault()
    const { username, isSelf, role, changePassword, oldPassword, newPassword } = editModal
    try {
      if (isSelf && changePassword) {
        const res = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ oldPassword, newPassword }) })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || 'Password change failed')
        addToast('Password changed — please log in again')
        // redirect to login page
        window.location.href = '/login?notice=password_changed'
        return
      }

      // Admin updating other user's role/password
      const body = {}
      if (role) body.role = role
      if (changePassword && newPassword) body.password = newPassword
      const url = `/api/users/${encodeURIComponent(username)}`
      const res2 = await fetch(url, { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      const j2 = await res2.json().catch(() => ({}))
      if (!res2.ok) throw new Error(j2.error || 'Update failed')
      addToast(`Updated ${username}`)
      setEditModal({ show: false })
      fetchPage()
    } catch (e) { addToast(e.message || 'Update failed', 'error') }
  }

  const pages = Math.max(1, Math.ceil(total / per))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a30]">
        <div>
          <h1 className="text-xl font-bold text-white">Users</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage user accounts and roles</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-400">Total: {total}</div>
          {isAdmin && (
            <>
              <button className="px-3 py-2 bg-green-600 text-white rounded flex items-center gap-2" onClick={()=>setCreateModal({...createModal, show:true})}>+ Add User</button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          <input className="bg-[#070712] border border-[#1a1a30] px-3 py-2 rounded w-80 text-sm" placeholder="Filter username" value={q} onChange={e=>{setQ(e.target.value); setPage(1)}} />
          <div className="ml-auto flex items-center gap-3">
            <div className="text-xs">Page {page} / {pages}</div>
            <select value={per} onChange={e=>{ setPer(Number(e.target.value)); fetchPage(1, Number(e.target.value)) }} className="px-2 py-1 border rounded bg-[#070712] text-sm">
              {[10,20,30,40,50].map(n=> <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-[#070712] border border-[#1a1a30] rounded-lg overflow-hidden">
          <div className="grid grid-cols-5 gap-4 p-3 font-semibold text-slate-400 bg-[#060612] border-b border-[#1a1a30]">
            <div>Username</div><div>Role</div><div className="text-center">Disabled</div><div>Created</div><div>Actions</div>
          </div>
          {loading && <div className="p-4">Loading...</div>}
          {!loading && users.map(u => (
            <div key={u.id} className="grid grid-cols-5 gap-4 p-3 border-t border-[#111221] items-center">
              <div className="font-medium text-white">{u.username}</div>
              <div className="text-slate-300">{u.role}</div>
              <div className="text-center text-slate-400">{u.disabled ? 'yes' : 'no'}</div>
              <div className="text-slate-400">{new Date(u.created_at).toLocaleString()}</div>
              <div className="flex items-center gap-2 justify-end">
                {isAdmin && u.role !== 'admin' && (
                  <button className="text-xs px-2 py-1 bg-indigo-600 text-white rounded" onClick={()=>promote(u.username)}>Promote</button>
                )}
                {(isAdmin || u.username === (window?.USER?.username ?? '')) && (
                  <button className="text-xs px-2 py-1 bg-yellow-500 text-black rounded" onClick={()=>editUser(u.username, u.username === (window?.USER?.username ?? ''))}>Edit</button>
                )}
                {isAdmin && u.username !== (window?.USER?.username ?? '') && (
                  <button className="text-xs px-2 py-1 bg-red-600 text-white rounded" onClick={()=>removeUser(u.username)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {editModal?.show && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <form onSubmit={submitEditModal} className="bg-[#0d0d1e] border border-[#1a1a30] rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-white mb-3">Edit {editModal.username}</h2>
            <div className="space-y-3">
              {/* Allow admin to change username when editing other users */}
              {(!editModal.isSelf) && (
                <div>
                  <label className="text-xs text-slate-400">Username</label>
                  <input className="w-full mt-1 p-2 bg-[#070712] border border-[#1a1a30] rounded" value={editModal.username} onChange={e=>setEditModal({...editModal, username: e.target.value})} />
                </div>
              )}
              {(!editModal.isSelf) && (
                <div>
                  <label className="text-xs text-slate-400">Role</label>
                  <select value={editModal.role} onChange={e=>setEditModal({...editModal, role: e.target.value})} className="w-full mt-1 p-2 bg-[#070712] border border-[#1a1a30] rounded">
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
              )}
              <div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!editModal.changePassword} onChange={e=>setEditModal({...editModal, changePassword: e.target.checked})} />
                  <span className="text-slate-300">Change password</span>
                </label>
              </div>
              {editModal.changePassword && (
                <div className="space-y-2">
                  {editModal.isSelf && (
                    <div>
                      <label className="text-xs text-slate-400">Old password</label>
                      <input type="password" value={editModal.oldPassword} onChange={e=>setEditModal({...editModal, oldPassword: e.target.value})} className="w-full mt-1 p-2 bg-[#070712] border border-[#1a1a30] rounded" />
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-slate-400">New password</label>
                    <input type="password" value={editModal.newPassword} onChange={e=>setEditModal({...editModal, newPassword: e.target.value})} className="w-full mt-1 p-2 bg-[#070712] border border-[#1a1a30] rounded" />
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" className="px-3 py-2 border rounded text-slate-300" onClick={()=>setEditModal({show:false})}>Cancel</button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded">Save</button>
            </div>
          </form>
        </div>
      )}

      {createModal?.show && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <form onSubmit={async (ev)=>{
            ev.preventDefault()
            try {
              const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ username: createModal.username?.trim(), password: createModal.password, role: createModal.role }) })
              const j = await res.json().catch(()=>({}))
              if (!res.ok) throw new Error(j.error || 'Create failed')
              addToast(`Created ${createModal.username}`)
              setCreateModal({ show: false, username: '', password: '', role: 'user' })
              fetchPage(1, per)
            } catch (e) { addToast(e.message || 'Create failed', 'error') }
          }} className="bg-[#0d0d1e] border border-[#1a1a30] rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-white mb-3">Create User</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">Username</label>
                <input className="w-full mt-1 p-2 bg-[#070712] border border-[#1a1a30] rounded" value={createModal.username} onChange={e=>setCreateModal({...createModal, username: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Password</label>
                <input type="password" className="w-full mt-1 p-2 bg-[#070712] border border-[#1a1a30] rounded" value={createModal.password} onChange={e=>setCreateModal({...createModal, password: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Role</label>
                <select className="w-full mt-1 p-2 bg-[#070712] border border-[#1a1a30] rounded" value={createModal.role} onChange={e=>setCreateModal({...createModal, role: e.target.value})}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" className="px-3 py-2 border rounded text-slate-300" onClick={()=>setCreateModal({ show:false, username:'', password:'', role:'user' })}>Cancel</button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded">Create</button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDelete?.show && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60">
          <div className="bg-[#0d0d1e] border border-[#1a1a30] rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white">Delete user</h3>
            <p className="text-slate-400 mt-2">Are you sure you want to delete <span className="font-medium text-white">{confirmDelete.username}</span>? This action cannot be undone.</p>
            <div className="mt-4 flex justify-end gap-3">
              <button className="px-3 py-2 border rounded text-slate-300" onClick={()=>setConfirmDelete({ show:false, username:null })}>Cancel</button>
              <button className="px-4 py-2 bg-red-600 text-white rounded" onClick={async ()=>{
                try {
                  const res = await fetch(`/api/users/${encodeURIComponent(confirmDelete.username)}`, { method: 'DELETE' })
                  const j = await res.json().catch(()=>({}))
                  if (!res.ok) throw new Error(j.error || 'Delete failed')
                  addToast(`Deleted ${confirmDelete.username}`)
                  setConfirmDelete({ show:false, username:null })
                  fetchPage()
                } catch (e) { addToast(e.message || 'Delete failed', 'error') }
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast stack for create/update/delete feedback */}
      <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur-sm ${{ 'error':'bg-red-950/95 border-red-500/30 text-red-300' }[t.type] || 'bg-emerald-950/95 border-emerald-500/30 text-emerald-300'}`}>
            {t.type === 'error' ? '⚠️' : '✅'} {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Users
