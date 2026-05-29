import { Cpu, HardDrive, Wifi, Server } from 'lucide-react'

function fmtBytes(b, dec = 1) {
  if (!b || b <= 0) return '0 B'
  const k = 1024
  const sz = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), sz.length - 1)
  return `${(b / Math.pow(k, i)).toFixed(dec)} ${sz[i]}`
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function GaugeBar({ pct }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const color =
    clamped > 90 ? 'bg-red-500' :
    clamped > 75 ? 'bg-amber-500' :
    clamped > 50 ? 'bg-indigo-400' :
    'bg-emerald-500'
  return (
    <div className="w-full bg-[#1a1a35] rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-1.5 rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function StatBlock({ label, value, muted }) {
  return (
    <div>
      <p className="text-slate-400 text-xs">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${muted ? 'text-slate-500' : 'text-slate-200'}`}>{value}</p>
    </div>
  )
}

export default function SystemStats({ systemStats }) {
  if (!systemStats) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white mb-2">System</h1>
        <p className="text-slate-500 text-sm">Loading system statistics…</p>
      </div>
    )
  }

  const { cpu, memory, disk, network, os } = systemStats

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">System</h1>
        <p className="text-slate-500 text-sm mt-1">
          {os?.hostname} · {os?.distro} {os?.release} · {os?.arch} · up {fmtUptime(os?.uptime ?? 0)}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* CPU */}
        <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-300">CPU</h3>
            <span className="ml-auto text-xs text-slate-400">{cpu?.cores} cores</span>
          </div>
          <div className="flex items-end gap-3 mb-3">
            <span className="text-4xl font-bold text-indigo-400">{cpu?.load ?? 0}<span className="text-2xl">%</span></span>
            <span className="text-xs text-slate-400 mb-1 truncate">{cpu?.model}</span>
          </div>
          <GaugeBar pct={cpu?.load ?? 0} />
          {cpu?.perCore?.length > 0 && (
            <div className="mt-4 grid grid-cols-4 gap-2">
              {cpu.perCore.map((load, i) => (
                <div key={i} className="text-center">
                  <div className="h-10 bg-[#1a1a35] rounded flex flex-col-reverse overflow-hidden" title={`Core ${i}: ${load}%`}>
                    <div
                      className="bg-indigo-500/60 transition-all duration-700"
                      style={{ height: `${load}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-700 mt-1">C{i}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Memory */}
        <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-300">Memory</h3>
          </div>
          <div className="flex items-end gap-3 mb-3">
            <span className="text-4xl font-bold text-emerald-400">{memory?.percent ?? 0}<span className="text-2xl">%</span></span>
            <span className="text-xs text-slate-400 mb-1">{fmtBytes(memory?.used)} used</span>
          </div>
          <GaugeBar pct={memory?.percent ?? 0} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatBlock label="Used" value={fmtBytes(memory?.used)} />
            <StatBlock label="Free" value={fmtBytes(memory?.free)} />
            <StatBlock label="Total" value={fmtBytes(memory?.total)} />
            {(memory?.swapTotal ?? 0) > 0 && (
              <StatBlock label="Swap" value={`${fmtBytes(memory?.swapUsed)} / ${fmtBytes(memory?.swapTotal)}`} muted />
            )}
          </div>
        </div>

        {/* Disk */}
        <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-slate-300">Disk</h3>
          </div>
          <div className="space-y-4">
            {(disk ?? []).filter(d => d.size > 0).map(d => (
              <div key={`${d.fs}-${d.mount}`}>
                <div className="flex justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-mono">{d.mount}</span>
                    {d.type && <span className="text-slate-700">{d.type}</span>}
                  </div>
                  <span className="text-slate-500">{fmtBytes(d.used)} / {fmtBytes(d.size)}</span>
                </div>
                <GaugeBar pct={d.use} />
              </div>
            ))}
          </div>
        </div>

        {/* Network */}
        <div className="bg-[#0f0f20] border border-[#1a1a30] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Wifi className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-300">Network</h3>
          </div>
          <div className="space-y-4">
            {(network ?? []).filter(n => n.iface !== 'lo').map(n => (
              <div key={n.iface}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-mono">{n.iface}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#1a1a35] rounded-lg px-3 py-2">
                    <p className="text-[10px] text-emerald-400/70 uppercase tracking-wide">Download</p>
                    <p className="text-sm font-bold text-emerald-400 font-mono mt-0.5">{fmtBytes(n.rx_sec)}/s</p>
                    <p className="text-[10px] text-slate-700 mt-1">total {fmtBytes(n.rx_bytes)}</p>
                  </div>
                  <div className="bg-[#1a1a35] rounded-lg px-3 py-2">
                    <p className="text-[10px] text-blue-400/70 uppercase tracking-wide">Upload</p>
                    <p className="text-sm font-bold text-blue-400 font-mono mt-0.5">{fmtBytes(n.tx_sec)}/s</p>
                    <p className="text-[10px] text-slate-700 mt-1">total {fmtBytes(n.tx_bytes)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
