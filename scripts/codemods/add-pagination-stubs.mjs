import fs from 'fs'
import path from 'path'

const ROOT = path.resolve('src','components')
const exts = ['.jsx','.js','.tsx','.ts']

function findFiles(dir){
  const out = []
  for (const f of fs.readdirSync(dir)){
    const p = path.join(dir,f)
    const st = fs.statSync(p)
    if (st.isDirectory()) out.push(...findFiles(p))
    else if (exts.includes(path.extname(f))) out.push(p)
  }
  return out
}

function now(){ return new Date().toISOString() }

const files = findFiles(ROOT).filter(fp => fs.readFileSync(fp,'utf8').includes('<table'))
console.log(`Found ${files.length} component files with <table> (scan time: ${now()})`)

let step = 0
const total = files.length
const applied = []
for (const f of files){
  step++
  const start = Date.now()
  let src = fs.readFileSync(f,'utf8')
  let changed = false

  // Add Pagination import if missing
  if (src.includes("from './Pagination'") || src.includes("from \"./Pagination\"")) {
    // already has import
  } else {
    // try to insert after first import block
    const impMatch = src.match(/(import [\s\S]*?\n)(\n|$)/)
    if (impMatch){
      const insertAt = impMatch.index + impMatch[1].length
      const before = src.slice(0, insertAt)
      const after = src.slice(insertAt)
      src = before + "import Pagination from './Pagination.jsx'\n" + after
      changed = true
    }
  }

  // Add per-page state stub if not present
  if (!/const \[per[,\s\]]/.test(src)){
    // find component function start (export default function ... or function ... export)
    const fnMatch = src.match(/export default function [^(]+\([^)]*\) \{/) || src.match(/function [A-Za-z0-9_]+\([^)]*\) \{[\s\S]*?export default/) || src.match(/export default\s*\(/)
    if (fnMatch){
      const idx = src.indexOf(fnMatch[0]) + fnMatch[0].length
      const inject = "\n  const [per, setPer] = useState(25) // inserted by codemod\n"
      // ensure useState import exists
      if (!src.includes("useState")){
        src = src.replace(/import\s+\{([^}]*)\}\s+from\s+'react'/, (m, g1) => {
          if (m.includes('useState')) return m
          return `import { ${g1.trim().replace(/\s+,\s*/g, ', ')} , useState } from 'react'`
        })
      }
      src = src.slice(0, idx) + inject + src.slice(idx)
      changed = true
    }
  }

  if (changed){
    fs.writeFileSync(f, src, 'utf8')
    applied.push(f)
  }
  const elapsed = ((Date.now()-start)/1000).toFixed(1)
  const percent = Math.round((step/total)*100)
  const eta = ((total-step)*(Date.now()-start)/1000).toFixed(0)
  console.log(`Step ${step}/${total} (${percent}%) ${path.relative(process.cwd(),f)} — ${changed? 'patched':'skipped'} — ${elapsed}s`) 
}

console.log('Codemod complete: patched', applied.length, 'files')
if (applied.length>0) console.log('Patched files:\n' + applied.join('\n'))
else console.log('No files modified')
