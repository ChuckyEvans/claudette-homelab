import { useState, useCallback } from 'react'
import { ShieldAlert, Network, Cpu, LayoutDashboard, ClipboardList, Settings, HelpCircle, LogOut, BarChart2, ChevronLeft, ChevronRight, Bell, X, ExternalLink } from 'lucide-react'
import { getUIPref, setUIPref } from '../lib/uiPrefs.js'
import ClaudetteLogo from './ClaudetteLogo.jsx'

const NAV = [
  { id: 'network',   label: 'Network',   icon: Network,         hint: 'Scan & map all devices on your LAN' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Live status overview of all monitored services' },
  { id: 'threats',   label: 'Exposure',  icon: ShieldAlert,     hint: 'Open port risk assessment per device' },
  { id: 'system',    label: 'System',    icon: Cpu,             hint: 'CPU, memory, temperature & Pi hardware stats' },
  { id: 'reports',   label: 'Reports',   icon: BarChart2,       hint: 'Speed tests, uptime history & charts' },
  { id: 'audit',     label: 'Audit Log', icon: ClipboardList,   hint: 'Full record of events & configuration changes' },
  { id: 'settings',  label: 'Settings',  icon: Settings,        hint: 'Configure hosts, schedules, themes & services' },
  { id: 'about',     label: 'About',     icon: HelpCircle,      hint: 'Version info, links & credits' },
]

function Tooltip({ text, side = 'right' }) {
  return (
    <div className={`absolute ${side === 'right' ? 'left-full ml-3' : 'left-full ml-3'} top-1/2 -translate-y-1/2 z-[999] pointer-events-none`}>
      <div className="bg-[#1a1a30] border border-[#2a2a45] text-slate-200 text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {text}
        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a30]" />
      </div>
    </div>
  )
}

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 400
const SIDEBAR_DEFAULT = 208

export default function Layout({ page, setPage, services, _threats, username, onLogout, _updateInfo, notifications = [], unreadCount = 0, onDismissNotification, onClearNotifications, onMarkAllRead, children }) {
  const failCount = services?.results?.filter(r => !r.ok).length ?? 0
  const allOk     = failCount === 0

  const [collapsed, setCollapsed] = useState(() => getUIPref('sidebar_collapsed') === 'true')
  const toggle = () => setCollapsed(c => {
    setUIPref('sidebar_collapsed', String(!c))
    return !c
  })

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(getUIPref('sidebar_width'))
    return !isNaN(saved) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, saved)) : SIDEBAR_DEFAULT
  })
  const [isDragging, setIsDragging] = useState(false)

  const onDragStart = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
    const startX = e.clientX
    const startW = sidebarWidth
    const onMouseMove = (ev) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX))
      setSidebarWidth(next)
    }
    const onMouseUp = (ev) => {
      const final = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX))
      setUIPref('sidebar_width', String(final))
      setSidebarWidth(final)
      setIsDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  const [notifOpen, setNotifOpen] = useState(false)
  const openNotif = () => { setNotifOpen(true); onMarkAllRead?.() }
  const closeNotif = () => setNotifOpen(false)

  const notifColors = (type) =>
    type === 'online'  ? 'bg-emerald-400' :
    type === 'offline' ? 'bg-slate-500'   :
    type === 'new'     ? 'bg-indigo-400'  :
    type === 'update'  ? 'bg-amber-400'   : 'bg-slate-400'

  const formatTs = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
           ' ' + d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`relative bg-[#080812]/70 border-r border-[#1a1a30] flex flex-col flex-shrink-0${isDragging ? '' : ' transition-[width] duration-200'}`}
        style={{ width: collapsed ? 56 : sidebarWidth }}
      >

        {/* Logo + collapse toggle */}
        <div className={`border-b border-[#1a1a30] flex items-center ${collapsed ? 'flex-col gap-2 py-3 px-2' : 'px-4 py-4 gap-2'}`}>
          {!collapsed && (
            <>
              <ClaudetteLogo className="w-7 h-7 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white font-bold tracking-widest text-sm uppercase">Claudette</div>
                <div className="text-slate-500 text-[10px]">Homelab Monitor</div>
              </div>
            </>
          )}
          {collapsed && (
            <ClaudetteLogo className="w-7 h-7" />
          )}

          {/* Bell with unread badge */}
          <div className="relative flex-shrink-0">
            <button
              onClick={openNotif}
              title="Notifications"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
            >
              <Bell className="w-3.5 h-3.5" />
            </button>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 bg-amber-500 text-[10px] font-bold text-white rounded-full flex items-center justify-center leading-none pointer-events-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          <button
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex-shrink-0 p-1.5 rounded-md text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors"
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Nav */}
        <nav className={`flex-1 ${collapsed ? 'px-1.5' : 'px-3'} py-4 overflow-y-auto space-y-0.5`}>
          {NAV.map(({ id, label, icon: Icon, hint }) => {
            const active = page === id
            return (
              <div key={id} className="relative group">
                <button
                  onClick={() => setPage(id)}
                  className={`w-full flex items-center gap-3 ${collapsed ? 'justify-center px-2' : 'px-3'} py-2.5 rounded-lg text-sm font-medium transition-all ${
                    active
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/25'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span className="flex-1 text-left">{label}</span>}

                </button>
                <Tooltip text={collapsed ? (hint ?? label) : hint} />
              </div>
            )
          })}
        </nav>

        {/* User + logout */}
        {username && (
          <div className={`${collapsed ? 'px-1.5' : 'px-3'} pb-2`}>
            {collapsed ? (
              <div className="relative group flex justify-center">
                <button
                  onClick={onLogout}
                  className="p-2 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
                <Tooltip text={`Sign out (${username})`} />
              </div>
            ) : (
              <div className="relative group flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-[#1a1a30]">
                <span className="flex-1 text-xs text-slate-400 truncate">{username}</span>
                <button
                  onClick={onLogout}
                  className="text-slate-600 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
                <Tooltip text="Sign out of Claudette" />
              </div>
            )}
          </div>
        )}

        {/* Health indicator */}
        <div className={`${collapsed ? 'px-2 py-3 flex justify-center' : 'px-5 py-4'} border-t border-[#1a1a30]`}>
          <div className="relative group">
            {collapsed ? (
              <span className="relative flex w-2.5 h-2.5 cursor-default">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${allOk ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${allOk ? 'bg-emerald-400' : 'bg-red-400'}`} />
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="relative flex w-2 h-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${allOk ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${allOk ? 'bg-emerald-400' : 'bg-red-400'}`} />
                </span>
                <span className="text-xs text-slate-400">
                  {allOk ? 'All systems nominal' : `${failCount} service${failCount > 1 ? 's' : ''} failing`}
                </span>
              </div>
            )}
            <Tooltip text={allOk ? 'All services are responding normally' : `${failCount} service${failCount > 1 ? 's' : ''} failing — check the Dashboard`} />
          </div>
        </div>
        {/* Drag-to-resize handle */}
        {!collapsed && (
          <div
            onMouseDown={onDragStart}
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize z-10 hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors"
          />
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* ── Notification panel ─────────────────────────────────────────────── */}
      {notifOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={closeNotif} />

          {/* Panel */}
          <div className="fixed top-0 right-0 h-screen w-80 z-50 bg-[#080812]/80 backdrop-blur-md border-l border-[#1a1a30] flex flex-col shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a30] flex-shrink-0">
              <span className="text-sm font-semibold text-slate-200">Notifications</span>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={onClearNotifications}
                    className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
                  >
                    Clear all
                  </button>
                )}
                <button onClick={closeNotif} className="p-1 text-slate-500 hover:text-slate-200 transition-colors rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#1a1a30]">
              {notifications.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-10">No notifications</p>
              ) : notifications.map(n => {
                const hasNav = !!(n.navigate?.page || n.navigate?.href)
                const handleNav = () => {
                  if (n.navigate?.page) { setPage(n.navigate.page); closeNotif() }
                  if (n.navigate?.href) window.open(n.navigate.href, '_blank', 'noopener,noreferrer')
                }
                return (
                  <div key={n.id} className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03] group">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${notifColors(n.type)}`} />
                    <div className="flex-1 min-w-0">
                      <p
                        onClick={hasNav ? handleNav : undefined}
                        className={`text-xs text-slate-300 leading-snug ${hasNav ? 'cursor-pointer hover:text-white' : ''}`}
                      >
                        {n.msg}
                        {hasNav && <ExternalLink className="inline w-3 h-3 ml-1 opacity-50" />}
                      </p>
                      {n.ts && (
                        <p className="text-[10px] text-slate-600 mt-0.5">{formatTs(n.ts)}</p>
                      )}
                    </div>
                    <button
                      onClick={() => onDismissNotification?.(n.id)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-slate-400 p-0.5 rounded"
                      aria-label="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
