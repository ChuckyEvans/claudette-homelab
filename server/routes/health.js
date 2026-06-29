import { Router } from 'express'
const router = Router()

router.get('/', (req, res) => {
  try {
    const lastRun = req.app.locals.lastRun || new Map()
    const obj = {}
    for (const [k, v] of lastRun.entries()) obj[k] = v
    res.json({ ok: true, uptimeMs: process.uptime() * 1000, lastRun: obj, ts: Date.now() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
