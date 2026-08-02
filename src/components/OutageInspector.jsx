import { useState, useEffect } from 'react'

function fmtTs(ts) { if (!ts) return '—'; try { return new Date(Number(ts)).toISOString() } catch { return String(ts) } }
function fmtDur(ms) { if (ms == null) return '—'; const s = Math.round(ms/1000); if (s < 60) return `${s}s`; const m = Math.floor(s/60); return `${m}m ${s%60}s` }

function exportCsv(rows, filename = 'export.csv') {
  if (!rows || !rows.length) return;
  try {
    const keys = Array.from(rows.reduce((acc, r) => { Object.keys(r || {}).forEach(k => acc.add(k)); return acc }, new Set()));
    const esc = v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') v = JSON.stringify(v);
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }
    const header = keys.join(',') + '\n';
    const body = rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    console.error('exportCsv failed', e);
  }
}

function downloadPdf(url, filename = 'report.pdf') {
  fetch(url, { method: 'GET' }).then(r => {
    if (!r.ok) throw new Error('PDF export failed')
    return r.blob()
  }).then(b => {
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }).catch(e => console.error('downloadPdf error', e))
}

export default function OutageInspector() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [netPage, setNetPage] = useState(0)
  const [netPageSize, setNetPageSize] = useState(50)
  const [tgtPage, setTgtPage] = useState(0)
  const [tgtPageSize, setTgtPageSize] = useState(50)

  useEffect(() => {
    fetch('/api/debug/outage-inspector').then(r => r.json()).then(j => setData(j)).catch(e => setErr(e.message))
  }, [])

  if (err) return <div className="p-6 text-red-300">Error: {err}</div>
  if (!data) return <div className="p-6">Loading outage inspector…</div>

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-3">Outage Inspector (temp)</h2>
      <div className="mb-4 text-sm text-slate-300">
        <div>Counts: network_outages: <strong>{data.counts.network_outages}</strong>, target_outages: <strong>{data.counts.target_outages}</strong></div>
        <div>Audit: checks: <strong>{data.counts.audit_internet_checks}</strong>, down/up: <strong>{data.counts.audit_internet_down_up}</strong></div>
        <div>Legacy rows (start in seconds): network: <strong>{data.legacy.network}</strong>, target: <strong>{data.legacy.target}</strong></div>
      </div>

      <section className="mb-6">
        <h3 className="font-medium">Recent network_outages (latest 200)</h3>
        <div className="flex items-center gap-3 mt-2 mb-2">
          <div className="text-sm text-slate-300">Page size:
            <select className="ml-2 bg-[#0b0b14] text-sm p-1" value={netPageSize} onChange={e => { setNetPageSize(Number(e.target.value)); setNetPage(0) }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <div className="ml-auto flex gap-2">
            <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => { exportCsv(data.networkOutages, 'network_outages.csv') }}>Export CSV</button>
            <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => downloadPdf('/api/debug/outage-inspector.pdf', 'outage-inspector-network.pdf')}>Export PDF</button>
            <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => window.print()}>Print (PDF)</button>
          </div>
        </div>
        <div className="overflow-auto border rounded mt-2 bg-[#080810] p-2 text-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400"><th>start</th><th>end</th><th>duration</th><th>uptime_before</th><th>type</th><th>ongoing</th><th>created_at</th></tr>
            </thead>
            <tbody>
              {data.networkOutages.slice(netPage * netPageSize, (netPage + 1) * netPageSize).map(r => (
                <tr key={r.start} className="border-t border-[#1a1a30]"><td>{fmtTs(r.start)}</td><td>{fmtTs(r.end)}</td><td>{fmtDur(r.duration_ms)}</td><td>{fmtDur(r.uptime_before_ms)}</td><td>{r.outage_type || '—'}</td><td>{r.ongoing ? 'yes' : 'no'}</td><td>{fmtTs(r.created_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => setNetPage(Math.max(0, netPage-1))}>Prev</button>
          <div className="text-xs text-slate-300">Page {netPage+1} / {Math.max(1, Math.ceil((data.networkOutages.length||0)/netPageSize))}</div>
          <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => setNetPage(Math.min(Math.ceil(data.networkOutages.length/netPageSize)-1, netPage+1))}>Next</button>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="font-medium">Recent target_outages (latest 500)</h3>
        <div className="flex items-center gap-3 mt-2 mb-2">
          <div className="text-sm text-slate-300">Page size:
            <select className="ml-2 bg-[#0b0b14] text-sm p-1" value={tgtPageSize} onChange={e => { setTgtPageSize(Number(e.target.value)); setTgtPage(0) }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <div className="ml-auto flex gap-2">
            <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => { exportCsv(data.targetOutages, 'target_outages.csv') }}>Export CSV</button>
            <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => downloadPdf('/api/debug/outage-inspector.pdf', 'outage-inspector-targets.pdf')}>Export PDF</button>
            <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => window.print()}>Print (PDF)</button>
          </div>
        </div>
        <div className="overflow-auto border rounded mt-2 bg-[#080810] p-2 text-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400"><th>start</th><th>host</th><th>end</th><th>dur</th><th>uptime_before</th><th>ongoing</th></tr>
            </thead>
            <tbody>
              {data.targetOutages.slice(tgtPage * tgtPageSize, (tgtPage + 1) * tgtPageSize).map((r, i) => (
                <tr key={`${r.start}-${r.host}-${i}`} className="border-t border-[#1a1a30]"><td>{fmtTs(r.start)}</td><td>{r.host}</td><td>{fmtTs(r.end)}</td><td>{fmtDur(r.duration_ms)}</td><td>{fmtDur(r.uptime_before_ms)}</td><td>{r.ongoing ? 'yes' : 'no'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => setTgtPage(Math.max(0, tgtPage-1))}>Prev</button>
          <div className="text-xs text-slate-300">Page {tgtPage+1} / {Math.max(1, Math.ceil((data.targetOutages.length||0)/tgtPageSize))}</div>
          <button className="bg-slate-700 text-xs px-2 py-1 rounded" onClick={() => setTgtPage(Math.min(Math.ceil(data.targetOutages.length/tgtPageSize)-1, tgtPage+1))}>Next</button>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="font-medium">Recent internet.check rows (latest 200)</h3>
        <div className="overflow-auto border rounded mt-2 bg-[#080810] p-2 text-sm">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-slate-400"><th>ts</th><th>payload (truncated)</th></tr></thead>
            <tbody>
              {data.recentChecks.map((r, i) => (
                <tr key={i} className="border-t border-[#1a1a30]"><td>{fmtTs(r.ts)}</td><td><pre className="whitespace-pre-wrap break-words max-w-md">{String(r.payload).slice(0,400)}</pre></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-medium">Recent internet.down/up events (latest 200)</h3>
        <div className="overflow-auto border rounded mt-2 bg-[#080810] p-2 text-sm">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-slate-400"><th>ts</th><th>event</th><th>payload</th></tr></thead>
            <tbody>
              {data.recentEvents.map((r, i) => (
                <tr key={i} className="border-t border-[#1a1a30]"><td>{fmtTs(r.ts)}</td><td>{r.event}</td><td><pre className="whitespace-pre-wrap break-words max-w-md">{String(r.payload).slice(0,400)}</pre></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
