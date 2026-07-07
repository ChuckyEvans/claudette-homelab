#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
const PROGRESS_FILE = `${tmpdir()}/claudette-deploy-progress.json`
let last = ''
function render(obj) {
  const { step='-', progress=0, message='' } = obj || {}
  const p = Math.round(progress * 100)
  const line = `Deploy: [${p}%] ${step} - ${message}`
  return line
}
function update() {
  try {
    if (!existsSync(PROGRESS_FILE)) return
    const txt = readFileSync(PROGRESS_FILE, 'utf8')
    const obj = JSON.parse(txt)
    const line = render(obj)
    if (line !== last) {
      // move cursor to top-left, clear first line, write sticky header
      process.stdout.write('\x1b7') // save cursor
      process.stdout.write('\x1b[1;1H') // move to 1,1
      process.stdout.write('\x1b[2K') // clear line
      process.stdout.write(line + '\n')
      process.stdout.write('\x1b8') // restore cursor
      last = line
    }
  } catch (e) {
    // ignore
  }
}
console.log('Sticky progress viewer started — showing deploy status at top')
update()
const t = setInterval(update, 1000)
process.on('exit', () => clearInterval(t))
