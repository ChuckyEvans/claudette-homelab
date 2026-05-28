import { useState, useEffect } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { api } from '../lib/api.js'
const claudetteLogo = '/favicon.svg'

export default function AuthModal({ onAuthenticated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [remember, setRemember] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [retryAfter, setRetryAfter] = useState(null)

  // Countdown timer for rate-limit lockout
  useEffect(() => {
    if (!retryAfter) return
    if (retryAfter <= 0) { setRetryAfter(null); return }
    const t = setTimeout(() => setRetryAfter(s => (s > 1 ? s - 1 : null)), 1000)
    return () => clearTimeout(t)
  }, [retryAfter])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (retryAfter) return
    setError(null)
    setLoading(true)
    try {
      const res = await api.auth.login({ username: username.trim(), password, remember })
      onAuthenticated(res.username)
    } catch (err) {
      if (err.status === 429 && err.retryAfter) setRetryAfter(err.retryAfter)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d0d1a] border border-[#1a1a30] rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="px-8 pt-8 pb-0 flex items-center gap-2.5">
          <img src={claudetteLogo} alt="Claudette" className="w-8 h-8" />
          <span className="text-white font-bold tracking-widest text-sm uppercase">Claudette</span>
        </div>

        <div className="px-8 py-6">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-indigo-600/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7 text-indigo-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-1">Sign in</h2>
            <p className="text-sm text-slate-500">Enter your credentials to continue.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Username</label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full bg-[#0a0a18] border border-[#1a1a35] rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="w-3.5 h-3.5 accent-indigo-500"
              />
              <span className="text-xs text-slate-400">Remember me for 30 days</span>
            </label>

            <button
              type="submit"
              disabled={loading || !!retryAfter || !username.trim() || !password}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-semibold transition-colors mt-2"
            >
              {loading ? 'Signing in…' : retryAfter ? `Try again in ${retryAfter}s` : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
