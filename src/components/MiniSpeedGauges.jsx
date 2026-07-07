import React, { useEffect, useRef, useState } from 'react'

function Gauge({ label, value, max = 100, unit = 'Mbps', size = 140, color = [59,79,212] }) {
  const w = size
  // give extra vertical padding so labels/numbers don't get clipped
  const extraH = 36
  const h = size
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) * 0.34
  const start = -150, end = 150
  const pct = Math.max(0, Math.min(1, (value || 0) / max))
  const angle = start + (end - start) * pct
  const toRad = (deg) => (deg * Math.PI) / 180
  // needle endpoint coords computed but not used directly (kept for clarity)
  // needle endpoint coords not needed; removed to satisfy linter
  const needleTransform = `rotate(${angle} ${cx} ${cy})`

  const arcPath = (s, e, rad) => {
    const sx = cx + rad * Math.cos(toRad(s))
    const sy = cy + rad * Math.sin(toRad(s))
    const ex = cx + rad * Math.cos(toRad(e))
    const ey = cy + rad * Math.sin(toRad(e))
    const large = Math.abs(e - s) > 180 ? 1 : 0
    return `M ${sx} ${sy} A ${rad} ${rad} 0 ${large} 1 ${ex} ${ey}`
  }

  const col = `rgb(${color[0]},${color[1]},${color[2]})`
  const arcWidth = 14
  const gap = 6

  return (
    <svg width={w} height={h + extraH} viewBox={`0 0 ${w} ${h + extraH}`} aria-label={label}>
      <defs>
        <filter id="gshadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.2" />
        </filter>
      </defs>
      {/* background arc */}
      <path d={arcPath(start, end, r)} stroke="#0f1724" strokeWidth={arcWidth} fill="none" strokeLinecap="round" />
      {/* value arc with subtle gaps (ticks) using stroke-dasharray */}
      <path
        d={arcPath(start, angle, r)}
        stroke={col}
        strokeWidth={arcWidth}
        fill="none"
        strokeLinecap="round"
        style={{ filter: 'url(#gshadow)', strokeDasharray: `${(Math.PI * r * (Math.abs(end - start) / 360) / 6).toFixed(2)} ${gap}` }}
      />
      {/* ticks */}
      {[0,0.2,0.4,0.6,0.8,1].map((t,i) => {
        const a = start + (end - start) * t
        const x1 = cx + (r - 6) * Math.cos(toRad(a))
        const y1 = cy + (r - 6) * Math.sin(toRad(a))
        const x2 = cx + (r + 6) * Math.cos(toRad(a))
        const y2 = cy + (r + 6) * Math.sin(toRad(a))
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.9} />
      })}
      {/* needle (rotated group for smooth CSS transitions) */}
      <g transform={needleTransform} style={{ transition: 'transform 500ms cubic-bezier(.2,.9,.2,1)', transformBox: 'fill-box' }}>
        <line x1={cx} y1={cy} x2={cx + r * 0.82} y2={cy} stroke="#0b1220" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill="#0b1220" stroke="#fff" strokeWidth={1.2} />
      </g>

      {/* Label + numeric */}
      <text x={cx} y={cy + r + 24} textAnchor="middle" fontSize="11" fill="#9aa6b3">{label}</text>
      <text x={cx} y={cy + 2} textAnchor="middle" fontSize="18" fontWeight="800" fill={col}>{value != null ? `${value}` : `-`}</text>
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize="11" fill="#9aa6b3">{unit}</text>
    </svg>
  )
}

export default function MiniSpeedGauges({ download = 0, upload = 0, ping = 0, maxDown = 200, maxUp = 200 }) {
  // internal displayed values for smooth animation
  const [dispDown, setDispDown] = useState(download)
  const [dispUp, setDispUp] = useState(upload)
  const [dispPing, setDispPing] = useState(ping)

  const rafRef = useRef(null)
  useEffect(() => {
    const start = performance.now()
    const fromDown = dispDown
    const toDown = download
    const fromUp = dispUp
    const toUp = upload
    const fromPing = dispPing
    const toPing = ping
    const duration = 600

    cancelAnimationFrame(rafRef.current)
    const step = (ts) => {
      const t = Math.min(1, (ts - start) / duration)
      const ease = (1 - Math.cos(Math.PI * t)) / 2
      setDispDown(fromDown + (toDown - fromDown) * ease)
      setDispUp(fromUp + (toUp - fromUp) * ease)
      setDispPing(Math.round(fromPing + (toPing - fromPing) * ease))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download, upload, ping])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <Gauge label="Download" value={Math.round(dispDown)} max={maxDown} unit="Mbps" color={[22,163,74]} />
        <Gauge label="Upload"   value={Math.round(dispUp)}   max={maxUp}   unit="Mbps" color={[59,79,212]} />
        <div style={{ width: 120, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#55617a' }}>Ping</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{dispPing != null ? `${dispPing} ms` : '\u2014'}</div>
        </div>
      </div>
    </div>
  )
}
