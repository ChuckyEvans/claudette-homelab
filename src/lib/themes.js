export const THEMES = [
  {
    id: 'starfield', label: 'Starfield', description: 'Deep navy, indigo glow', accent: '#6366f1',
    preview: 'radial-gradient(ellipse 100% 40% at 50% 120%, rgba(30,20,80,0.9) 0%, transparent 100%), radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.9) 0%, transparent 100%), radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,0.7) 0%, transparent 100%), radial-gradient(1px 1px at 45% 15%, rgba(255,255,255,0.9) 0%, transparent 100%), radial-gradient(2px 2px at 55% 45%, rgba(180,200,255,0.7) 0%, transparent 100%), #060610',
  },
  {
    id: 'dark', label: 'Dark', description: 'Classic dark, clean & minimal', accent: '#6366f1',
    preview: 'linear-gradient(180deg, #0d0d14 0%, #0a0a10 100%)',
  },
  {
    id: 'nebula', label: 'Nebula', description: 'Deep space, violet clouds', accent: '#a855f7',
    preview: 'radial-gradient(ellipse 80% 60% at 25% 55%, rgba(130,0,200,0.65) 0%, transparent 60%), radial-gradient(ellipse 55% 45% at 75% 30%, rgba(50,0,230,0.5) 0%, transparent 55%), radial-gradient(ellipse 40% 50% at 80% 80%, rgba(210,60,210,0.4) 0%, transparent 50%), radial-gradient(1px 1px at 15% 20%, rgba(255,255,255,0.8) 0%, transparent 100%), radial-gradient(1px 1px at 60% 70%, rgba(255,255,255,0.6) 0%, transparent 100%), #08000f',
  },
  {
    id: 'aurora', label: 'Aurora', description: 'Northern lights, teal sky', accent: '#14b8a6',
    preview: 'linear-gradient(175deg, transparent 35%, rgba(0,210,110,0.45) 52%, rgba(0,160,210,0.35) 63%, transparent 74%), linear-gradient(168deg, transparent 28%, rgba(20,200,140,0.3) 46%, rgba(80,0,220,0.25) 62%, transparent 74%), radial-gradient(ellipse 80% 20% at 50% 100%, rgba(0,20,20,0.9) 0%, transparent 100%), #000a0b',
  },
  {
    id: 'synthwave', label: 'Synthwave', description: '80s retro grid, hot pink', accent: '#e879f9',
    preview: 'radial-gradient(ellipse 120% 25% at 50% 100%, rgba(255,0,200,0.5) 0%, transparent 55%), radial-gradient(ellipse 80% 15% at 50% 100%, rgba(0,200,255,0.3) 0%, transparent 45%), radial-gradient(ellipse 50% 50% at 50% 50%, rgba(120,0,80,0.2) 0%, transparent 100%), #0a0014',
  },
  {
    id: 'ocean', label: 'Ocean', description: 'Deep sea, cyan caustics', accent: '#06b6d4',
    preview: 'radial-gradient(ellipse 60% 30% at 20% 20%, rgba(0,160,200,0.25) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 75% 40%, rgba(0,180,200,0.2) 0%, transparent 55%), radial-gradient(ellipse 100% 35% at 50% 100%, rgba(0,40,80,0.9) 0%, transparent 100%), linear-gradient(180deg, #000d1a 0%, #001424 60%, #001830 100%)',
  },
  {
    id: 'forest', label: 'Forest', description: 'Night forest, emerald mist', accent: '#10b981',
    preview: 'radial-gradient(ellipse 80% 30% at 30% 60%, rgba(0,80,20,0.4) 0%, transparent 60%), radial-gradient(ellipse 60% 20% at 80% 40%, rgba(20,120,40,0.25) 0%, transparent 50%), radial-gradient(ellipse 100% 25% at 50% 100%, rgba(0,20,5,0.95) 0%, transparent 100%), linear-gradient(180deg, #010d03 0%, #011406 100%)',
  },
  {
    id: 'volcanic', label: 'Volcanic', description: 'Lava rock, ember glow', accent: '#f97316',
    preview: 'radial-gradient(ellipse 80% 40% at 50% 100%, rgba(200,50,0,0.7) 0%, transparent 55%), radial-gradient(ellipse 40% 25% at 20% 80%, rgba(240,80,0,0.4) 0%, transparent 50%), radial-gradient(ellipse 30% 20% at 80% 70%, rgba(255,100,0,0.35) 0%, transparent 45%), linear-gradient(180deg, #0d0100 0%, #160200 100%)',
  },
  {
    id: 'arctic', label: 'Arctic', description: 'Ice crystals, frost blue', accent: '#38bdf8',
    preview: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(100,200,255,0.2) 0%, transparent 60%), radial-gradient(ellipse 50% 30% at 20% 50%, rgba(150,220,255,0.15) 0%, transparent 50%), radial-gradient(ellipse 40% 25% at 80% 70%, rgba(100,180,255,0.1) 0%, transparent 45%), linear-gradient(180deg, #020b14 0%, #030f1e 100%)',
  },
  {
    id: 'matrix', label: 'Matrix', description: 'Digital rain, phosphor green', accent: '#22c55e',
    preview: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(0,60,0,0.5) 0%, transparent 70%), radial-gradient(ellipse 100% 30% at 50% 100%, rgba(0,30,0,0.9) 0%, transparent 100%), linear-gradient(180deg, #000900 0%, #000d00 100%)',
  },
  {
    id: 'crimson', label: 'Crimson', description: 'Gothic dark, blood red', accent: '#ef4444',
    preview: 'radial-gradient(ellipse 60% 50% at 75% 20%, rgba(180,0,0,0.35) 0%, transparent 55%), radial-gradient(ellipse 80% 40% at 30% 70%, rgba(120,0,0,0.3) 0%, transparent 55%), radial-gradient(ellipse 100% 30% at 50% 100%, rgba(80,0,0,0.9) 0%, transparent 100%), linear-gradient(180deg, #0d0000 0%, #110000 100%)',
  },
  {
    id: 'cobalt', label: 'Cobalt', description: 'Industrial blue, steel glow', accent: '#3b82f6',
    preview: 'radial-gradient(ellipse 70% 40% at 60% 30%, rgba(0,60,180,0.3) 0%, transparent 55%), radial-gradient(ellipse 50% 30% at 20% 70%, rgba(0,40,140,0.25) 0%, transparent 50%), radial-gradient(ellipse 100% 25% at 50% 100%, rgba(0,10,40,0.95) 0%, transparent 100%), linear-gradient(180deg, #00050f 0%, #000a1a 100%)',
  },
  {
    id: 'amber', label: 'Amber', description: 'Desert night, golden warmth', accent: '#f59e0b',
    preview: 'radial-gradient(ellipse 80% 40% at 50% 100%, rgba(180,80,0,0.5) 0%, transparent 55%), radial-gradient(ellipse 50% 30% at 20% 60%, rgba(200,100,0,0.2) 0%, transparent 50%), radial-gradient(ellipse 40% 20% at 80% 30%, rgba(255,160,0,0.1) 0%, transparent 45%), linear-gradient(180deg, #0d0700 0%, #120900 100%)',
  },
  {
    id: 'crystal', label: 'Crystal', description: 'Rose quartz, soft shimmer', accent: '#ec4899',
    preview: 'radial-gradient(ellipse 70% 50% at 30% 40%, rgba(180,0,100,0.35) 0%, transparent 55%), radial-gradient(ellipse 55% 40% at 75% 65%, rgba(220,40,120,0.25) 0%, transparent 50%), radial-gradient(ellipse 100% 30% at 50% 100%, rgba(80,0,40,0.9) 0%, transparent 100%), linear-gradient(180deg, #0d0009 0%, #120010 100%)',
  },
  {
    id: 'circuit', label: 'Circuit', description: 'PCB board, trace glow', accent: '#34d399',
    preview: 'radial-gradient(ellipse 60% 40% at 40% 50%, rgba(0,120,60,0.25) 0%, transparent 55%), radial-gradient(ellipse 50% 30% at 75% 30%, rgba(0,160,80,0.2) 0%, transparent 50%), radial-gradient(ellipse 100% 25% at 50% 100%, rgba(0,30,15,0.95) 0%, transparent 100%), linear-gradient(180deg, #000d05 0%, #001008 100%)',
  },
  {
    id: 'storm', label: 'Storm', description: 'Thunderstorm, silver light', accent: '#94a3b8',
    preview: 'radial-gradient(ellipse 80% 50% at 60% 30%, rgba(60,80,120,0.35) 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 20% 60%, rgba(40,60,100,0.3) 0%, transparent 50%), radial-gradient(ellipse 100% 30% at 50% 100%, rgba(10,15,30,0.95) 0%, transparent 100%), linear-gradient(180deg, #050810 0%, #080c18 100%)',
  },
]

export const DEFAULT_THEME = 'starfield'

export const VALID_THEME_IDS = THEMES.map(t => t.id)

/** Apply a theme by setting data-theme on <html>. Falls back to 'starfield'. */
export function applyTheme(themeId) {
  const id = VALID_THEME_IDS.includes(themeId) ? themeId : DEFAULT_THEME
  document.documentElement.setAttribute('data-theme', id)
}
