import { useState, useRef } from 'react'

/**
 * Lightweight tooltip component.
 * Usage: <Tooltip tip="Description"><button>...</button></Tooltip>
 * Props:
 *   tip      — tooltip text
 *   side     — 'top' | 'bottom' | 'left' | 'right'  (default: 'top')
 *   delay    — ms before showing              (default: 400)
 *   className — extra classes on the wrapper div
 */
export default function Tooltip({ tip, side = 'top', delay = 400, className = '', children }) {
  const [visible, setVisible] = useState(false)
  const timer = useRef(null)

  if (!tip) return <>{children}</>

  const show = () => { timer.current = setTimeout(() => setVisible(true),  delay) }
  const hide = () => { clearTimeout(timer.current); setVisible(false) }

  const pos = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left:   'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side] ?? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'

  const arrow = {
    top:    'top-full left-1/2 -translate-x-1/2 border-t-[#2a2a40] border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-[#2a2a40] border-l-transparent border-r-transparent border-t-transparent',
    left:   'left-full top-1/2 -translate-y-1/2 border-l-[#2a2a40] border-t-transparent border-b-transparent border-r-transparent',
    right:  'right-full top-1/2 -translate-y-1/2 border-r-[#2a2a40] border-t-transparent border-b-transparent border-l-transparent',
  }[side] ?? 'top-full left-1/2 -translate-x-1/2 border-t-[#2a2a40] border-l-transparent border-r-transparent border-b-transparent'

  return (
    <div
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div className={`absolute ${pos} z-[500] pointer-events-none`}>
          <div className="bg-[#1c1c2e] border border-[#2a2a40] text-slate-300 text-[11px] leading-snug px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap max-w-[220px] whitespace-normal text-center">
            {tip}
          </div>
          <span className={`absolute border-4 ${arrow}`} />
        </div>
      )}
    </div>
  )
}
