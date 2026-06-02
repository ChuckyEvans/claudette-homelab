import { useId } from 'react'

/**
 * Claudette C-radar logo as an inline SVG.
 * Uses useId() so gradient IDs are unique per instance,
 * avoiding conflicts when the logo appears in multiple places simultaneously.
 */
export default function ClaudetteLogo({ className = 'w-7 h-7', style }) {
  const uid = useId()
  const bgId   = `${uid}-bg`
  const coreId = `${uid}-core`
  const blipId = `${uid}-blip`

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className={className} style={style}>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#12122a"/>
          <stop offset="100%" stopColor="#090916"/>
        </linearGradient>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#c7d2fe"/>
          <stop offset="45%"  stopColor="#6366f1"/>
          <stop offset="100%" stopColor="#4338ca"/>
        </radialGradient>
        <radialGradient id={blipId} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#e0e7ff"/>
          <stop offset="100%" stopColor="#818cf8"/>
        </radialGradient>
      </defs>

      {/* Background */}
      <rect width="32" height="32" rx="7" fill={`url(#${bgId})`}/>

      {/* Inner reference ring */}
      <circle cx="16" cy="16" r="6" fill="none" stroke="#4f46e5" strokeWidth="0.8" opacity="0.35"/>

      {/* Main C arc */}
      <path d="M21,7.3 A10,10 0 1,0 21,24.7"
            fill="none" stroke="#6366f1" strokeWidth="3.2" strokeLinecap="round"/>

      {/* Highlight on top arm of C */}
      <path d="M21,7.3 A10,10 0 0,0 6,16"
            fill="none" stroke="#818cf8" strokeWidth="3.2" strokeLinecap="round" opacity="0.35"/>

      {/* Scan beam */}
      <line x1="18.2" y1="16" x2="22.8" y2="16"
            stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round"/>

      {/* Center emitter */}
      <circle cx="16" cy="16" r="2.6" fill={`url(#${coreId})`}/>

      {/* Detected blip */}
      <circle cx="21" cy="10.5" r="2"   fill="#4f46e5" opacity="0.5"/>
      <circle cx="21" cy="10.5" r="1.3" fill={`url(#${blipId})`}/>
    </svg>
  )
}
