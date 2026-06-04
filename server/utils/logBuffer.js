/**
 * In-memory rolling log buffer.
 * Patches console.log/info/warn/error/debug to capture all server output.
 * Keeps the last MAX_ENTRIES entries in a circular array.
 */

const MAX_ENTRIES = 5000

const _buffer = []
let _seq = 0

/** Call once at server startup (before other imports that log at module load time) */
export function initLogBuffer() {
  const patch = (level, orig) => (...args) => {
    const message = args
      .map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })()))
      .join(' ')
    _buffer.push({ seq: ++_seq, ts: Date.now(), level, message })
    if (_buffer.length > MAX_ENTRIES) _buffer.shift()
    orig.apply(console, args)
  }

  console.log   = patch('info',  console.log.bind(console))
  console.info  = patch('info',  console.info.bind(console))
  console.warn  = patch('warn',  console.warn.bind(console))
  console.error = patch('error', console.error.bind(console))
  console.debug = patch('debug', console.debug.bind(console))
}

/**
 * Count log entries by level since a given timestamp.
 * @param {number} since - Unix milliseconds; only entries with ts > since are counted.
 * @returns {{ info: number, warn: number, error: number, debug: number }}
 */
export function getLogCounts(since = 0) {
  const counts = { info: 0, warn: 0, error: 0, debug: 0 }
  for (const entry of _buffer) {
    if (entry.ts > since && counts[entry.level] !== undefined) {
      counts[entry.level]++
    }
  }
  return counts
}

/**
 * Query the log buffer.
 * @param {{ levels?: string[], search?: string, page?: number, pageSize?: number, order?: 'asc'|'desc' }} opts
 * @returns {{ logs: object[], total: number, page: number, pageSize: number, totalPages: number }}
 */
export function getLogs({ levels = [], search = '', page = 1, pageSize = 100, order = 'asc' } = {}) {
  let entries = [..._buffer]  // copy so we can mutate safely

  if (levels.length > 0) {
    entries = entries.filter(e => levels.includes(e.level))
  }
  if (search) {
    const q = search.toLowerCase()
    entries = entries.filter(e => e.message.toLowerCase().includes(q))
  }

  // _buffer is already oldest-first (push to tail). Reverse for desc order.
  if (order === 'desc') entries = entries.reverse()

  const total      = entries.length
  const totalPages = Math.ceil(total / pageSize) || 1
  const safePage   = Math.min(Math.max(1, page), totalPages)
  const start      = (safePage - 1) * pageSize

  return {
    logs: entries.slice(start, start + pageSize),
    total,
    page:      safePage,
    pageSize,
    totalPages,
  }
}
