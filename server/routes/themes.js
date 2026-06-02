import express from 'express'
import fs from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDataDir, audit } from '../db.js'

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const VALID_IDS = new Set([
  'milkyway','aurora','sahara','coastal','amazon','alpine',
  'volcanic','savanna','outback','glacier','reef','redwood',
  'monsoon','bioluminescent',
])

const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif'])
const MAX_BYTES = 10 * 1024 * 1024  // 10 MB

router.post('/upload/:id', async (req, res) => {
  const id = req.params.id
  if (!VALID_IDS.has(id)) return res.status(400).json({ ok: false, error: 'Unknown theme id' })

  const ct = req.headers['content-type'] ?? ''
  if (!ALLOWED_TYPES.has(ct.split(';')[0].trim())) {
    return res.status(400).json({ ok: false, error: 'Content-Type must be image/jpeg, image/png, image/webp, or image/gif' })
  }

  const themesDir = path.join(getDataDir(), 'themes')
  fs.mkdirSync(themesDir, { recursive: true })

  const dest  = path.join(themesDir, `${id}.jpg`)
  const thumb = path.join(themesDir, `${id}-thumb.jpg`)
  const tmp   = dest + '.tmp'

  let bytes = 0
  req.on('data', chunk => { bytes += chunk.length })

  try {
    await pipeline(req, fs.createWriteStream(tmp))
    if (bytes > MAX_BYTES) {
      fs.unlinkSync(tmp)
      return res.status(413).json({ ok: false, error: `Image too large (max ${MAX_BYTES / 1024 / 1024} MB)` })
    }
    fs.renameSync(tmp, dest)
    fs.copyFileSync(dest, thumb)
    audit('themes.upload', { id }, req.user?.id ?? 'anon', req.ip)
    res.json({ ok: true })
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
