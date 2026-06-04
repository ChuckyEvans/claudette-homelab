import { useState, useEffect } from 'react'

/**
 * Thin top-of-viewport progress bar driven by real scan progress.
 * active: bool — whether a scan is running
 * progress: 0-100 | null — actual percentage from nmap; null = not yet reported
 */
export default function TopProgressBar({ active, progress }) {
  const [visible, setVisible]   = useState(false)
  const [displayW, setDisplayW] = useState(0)
  const [fading, setFading]     = useState(false)

  const indeterminate = active && progress == null

  useEffect(() => {
    if (active) {
      setFading(false)
      setVisible(true)
      if (progress != null) setDisplayW(progress)
    } else if (visible) {
      // Scan finished — fill to 100 then fade out
      setDisplayW(100)
      setFading(true)
      const t = setTimeout(() => {
        setVisible(false)
        setDisplayW(0)
        setFading(false)
      }, 600)
      return () => clearTimeout(t)
    }
  }, [active, progress]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[200] h-0.5 pointer-events-none${indeterminate ? ' overflow-hidden' : ''}`}
      style={{ opacity: fading ? 0 : 1, transition: fading ? 'opacity 600ms' : 'none' }}
    >
      {indeterminate ? (
        <div
          className="h-full w-1/3 animate-indeterminate bg-indigo-500"
          style={{ boxShadow: '0 0 8px rgba(99,102,241,0.8)', transformOrigin: 'left center' }}
        />
      ) : (
        <div
          style={{
            width: `${displayW}%`,
            transition: 'width 600ms ease-out',
            boxShadow: '0 0 8px rgba(99,102,241,0.8)',
          }}
          className="h-full bg-indigo-500"
        />
      )}
    </div>
  )
}
