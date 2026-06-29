#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROGRESS_FILE = join(tmpdir(), 'claudette-deploy-progress.json')

function fmtSecs(s) {
  s = Math.max(0, Math.round(s))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}m ${sec}s`
}

function readProgress() {
  if (!existsSync(PROGRESS_FILE)) return null
  try {
    const raw = readFileSync(PROGRESS_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

function render(p) {
  if (!p) { console.log('No progress file yet.'); return }
  const now = Date.now()
  const elapsed = (now - (p.startTime || p.timestamp || now)) / 1000
  const prog = Math.max(0, Math.min(1, Number(p.progress) || 0))
  const eta = prog > 0 ? (elapsed * (1 - prog) / prog) : null
  console.clear()
  console.log(`Step: ${p.step || 'unknown'}    Message: ${p.message || ''}`)
  console.log(`Progress: ${(prog * 100).toFixed(1)}%`) 
  console.log(`Elapsed: ${fmtSecs(elapsed)}${eta !== null ? '    ETA: ' + fmtSecs(eta) : '    ETA: estimating...'}`)
  if (p.logs) console.log('\nRecent: \n' + p.logs.join('\n'))
}

console.log('Tailing deploy progress file:', PROGRESS_FILE)
setInterval(() => {
  const p = readProgress()
  render(p)
}, 1000)
