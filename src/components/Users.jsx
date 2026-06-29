import React, { useEffect, useState } from 'react'

function Users() {
  const [users, setUsers] = useState([])
  const [page, setPage] = useState(1)
  const [per] = useState(20)
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

  async function fetchPage() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, per, q })
      const res = await fetch('/api/users?' + params.toString())
      const json = await res.json()
      setUsers(json.items || [])
      setTotal(json.total || 0)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function promote(username) {
    await fetch(`/api/users/${encodeURIComponent(username)}/promote`, { method: 'POST' })
    fetchPage()
  }

  async function removeUser(username) {
    if (!confirm(`Delete user ${username}? This cannot be undone.`)) return
    await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
    fetchPage()
  }

  async function editUser(username) {
    const newRole = prompt('Enter role for user (user/admin):', 'user')
    if (newRole === null) return
    const newPassword = prompt('Enter new password (leave blank to keep current):', '')
    const body = {}
    if (newRole) body.role = newRole
    if (newPassword) body.password = newPassword
    await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    fetchPage()
  }

  const pages = Math.max(1, Math.ceil(total / per))

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-2">Users</h2>
      <div className="flex gap-2 mb-3">
        <input className="border p-1" placeholder="Filter (abc)" value={q} onChange={e=>{setQ(e.target.value); setPage(1)}} />
        <div className="ml-auto">Total: {total}</div>
      </div>
      <div className="border rounded">
        <div className="grid grid-cols-4 gap-2 p-2 font-semibold bg-gray-100">
          <div>Username</div><div>Role</div><div>Disabled</div><div>Created</div>
        </div>
        {loading && <div className="p-4">Loading...</div>}
        {!loading && users.map(u => (
          <div key={u.id} className="grid grid-cols-4 gap-2 p-2 border-t items-center">
            <div>{u.username}</div>
            <div>{u.role}</div>
            <div>{u.disabled}</div>
            <div className="flex items-center gap-2">
              <div>{new Date(u.created_at).toLocaleString()}</div>
              {isAdmin && u.role !== 'admin' && (
                <button className="ml-2 text-xs px-2 py-1 bg-indigo-600 text-white rounded" onClick={()=>promote(u.username)}>Promote</button>
              )}
              {isAdmin && (
                <>
                  <button className="ml-2 text-xs px-2 py-1 bg-yellow-500 text-black rounded" onClick={()=>editUser(u.username)}>Edit</button>
                  <button className="ml-2 text-xs px-2 py-1 bg-red-600 text-white rounded" onClick={()=>removeUser(u.username)}>Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="btn">Prev</button>
        <div>Page {page} / {pages}</div>
        <button disabled={page>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))} className="btn">Next</button>
      </div>
    </div>
  )
}

export default Users
