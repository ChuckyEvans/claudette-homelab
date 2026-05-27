import { useState } from 'react'
import { Shield, ShieldAlert, Network, Cpu, LayoutDashboard, ClipboardList, Settings, Wand2, HelpCircle, LogOut, BarChart2, ChevronLeft, ChevronRight } from 'lucide-react'
import claudetteLogo from '/favicon.svg'

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

export default function Layout({ page, setPage, services, threats, onShowWizard, username, onLogout, children }) {
  const failCount = services?.results?.filter(r => !r.ok).length ?? 0
  const allOk     = failCount === 0

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const toggle = () => setCollapsed(c => {
    localStorage.setItem('sidebar-collapsed', String(!c))
    return !c
  })

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-14' : 'w-52'} bg-[#080812] border-r border-[#1a1a30] flex flex-col flex-shrink-0 transition-all duration-200`}>

        {/* Logo + collapse toggle */}
        <div className={`border-b border-[#1a1a30] flex items-center ${collapsed ? 'flex-col gap-2 py-3 px-2' : 'px-4 py-4 gap-2'}`}>
          {!collapsed && (
            <>
              <img src={claudetteLogo} alt="Claudette" className="w-7 h-7 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white font-bold tracking-widest text-sm uppercase">Claudette</div>
                <div className="text-slate-500 text-[10px]">Homelab Monitor</div>
              </div>
            </>
          )}
          {collapsed && (
            <img src={claudetteLogo} alt="Claudette" className="w-7 h-7" />
          )}
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

        {/* Setup Wizard */}
        <div className={`${collapsed ? 'px-1.5' : 'px-3'} pb-2`}>
          <div className="relative group">
            <button
              onClick={onShowWizard}
              className={`w-full flex items-center gap-3 ${collapsed ? 'justify-center px-2' : 'px-3'} py-2 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-600/10 transition-all text-sm`}
            >
              <Wand2 className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Setup Wizard</span>}
            </button>
            <Tooltip text="Re-run the initial setup wizard" />
          </div>
        </div>

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
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
