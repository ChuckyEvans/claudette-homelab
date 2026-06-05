import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

/** Returns an array of page numbers (1-indexed) and '...' separators. */
function getPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const range = []
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - 2 && i <= current + 2)) range.push(i)
  }
  const result = []
  let prev = null
  for (const i of range) {
    if (prev !== null) {
      if (i - prev === 2) result.push(prev + 1)
      else if (i - prev > 2) result.push('...')
    }
    result.push(i)
    prev = i
  }
  return result
}

const BTN_NAV  = 'flex items-center justify-center w-7 h-7 rounded text-xs transition-colors text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed'
const BTN_PAGE = (active) => `flex items-center justify-center w-7 h-7 rounded text-xs font-medium transition-colors ${
  active ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'
}`

/**
 * Full pagination bar.
 * @param {number}   page       0-indexed current page
 * @param {number}   totalPages total page count
 * @param {function} onPage     called with 0-indexed target page
 */
export default function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null
  const pages = getPageRange(page + 1, totalPages)
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={() => onPage(0)} disabled={page === 0} className={BTN_NAV} title="First page">
        <ChevronsLeft className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onPage(page - 1)} disabled={page === 0} className={BTN_NAV} title="Previous">
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      {pages.map((p, i) =>
        p === '...'
          ? <span key={`d${i}`} className="w-7 text-center text-xs text-slate-500 select-none">…</span>
          : <button key={p} onClick={() => onPage(p - 1)} className={BTN_PAGE(page === p - 1)}>{p}</button>
      )}
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1} className={BTN_NAV} title="Next">
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onPage(totalPages - 1)} disabled={page >= totalPages - 1} className={BTN_NAV} title="Last page">
        <ChevronsRight className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
