import { Router } from 'express'
import PDFDocument from 'pdfkit'
import { getDb, backfillInternetSummary, ensureInternetSummary } from '../db.js'
const router = Router()

// Run EXPLAIN QUERY PLAN for a provided SQL (POST body: { sql: 'SELECT ...' })
router.post('/explain', (req, res) => {
  try {
    const sql = req.body?.sql
    if (!sql) return res.status(400).json({ error: 'Missing sql in body' })
    const plan = getDb().all(`EXPLAIN QUERY PLAN ${sql}`)
    res.json({ plan })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Trigger backfill of internet summary (optionally provide fromTs/toTs in body)
router.post('/backfill/internet-summary', (req, res) => {
  try {
    ensureInternetSummary()
    const fromTs = Number(req.body?.fromTs ?? 0)
    const toTs = Number(req.body?.toTs ?? Date.now())
    const rows = backfillInternetSummary(fromTs, toTs)
    res.json({ backfilledDays: rows })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Run detectors persistence once (for debugging)
router.post('/run-detectors', async (req, res) => {
  try {
    const detectors = await import('../lib/detectors.js')
    const results = {}
    if (detectors.persistIpClashes) results.ipClashes = await detectors.persistIpClashes(200)
    if (detectors.persistMacIpChurn) results.macIpChurn = await detectors.persistMacIpChurn(200)
    if (detectors.persistPortScans) results.portScans = await detectors.persistPortScans(200)
    if (detectors.persistBeacons) results.beacons = await detectors.persistBeacons(200)
    if (detectors.persistAuthFailures) results.authFailures = await detectors.persistAuthFailures(200)
    if (detectors.persistThreatMatches) results.threatMatches = await detectors.persistThreatMatches(200)
    res.json({ ok: true, results })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router

// Temporary debug endpoint: outage inspector
router.get('/outage-inspector', (req, res) => {
  try {
    const db = getDb()
    const rawNetworkOutages = db.all('SELECT start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM network_outages ORDER BY start DESC LIMIT 200')
    const rawTargetOutages = db.all('SELECT start,host,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM target_outages ORDER BY start DESC LIMIT 500')
    const recentChecks = db.all("SELECT ts, payload FROM audit_log WHERE event IN ('internet.check') ORDER BY ts DESC LIMIT 200")
    const recentEvents = db.all("SELECT ts, event, payload FROM audit_log WHERE event IN ('internet.down','internet.up') ORDER BY ts DESC LIMIT 200")
        // Helpers to normalize timestamps/durations coming from DB (some rows use seconds)
        const toMs = (v) => {
          if (v == null) return null
          const n = Number(v)
          if (!isFinite(n)) return null
          return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
        }
        const toIso = (v) => {
          const ms = toMs(v)
          return ms == null ? null : new Date(ms).toISOString()
        }
        const normalizeDurationMs = (v) => {
          if (v == null) return null
          const n = Number(v)
          if (!isFinite(n)) return null
          // heuristic: if small (<100000) it's probably seconds
          if (n > 0 && n < 1e5) return Math.round(n * 1000)
          return Math.round(n)
        }

        const networkOutages = rawNetworkOutages.map(r => ({
          // normalize numeric fields to consistent milliseconds values and provide ISO strings
          start: toMs(r.start),
          end: r.end == null ? null : toMs(r.end),
          duration_ms: normalizeDurationMs(r.duration_ms),
          uptime_before_ms: normalizeDurationMs(r.uptime_before_ms),
          outage_type: r.outage_type,
          ongoing: r.ongoing,
          created_at: toMs(r.created_at),
          start_iso: toIso(r.start),
          end_iso: r.end == null ? null : toIso(r.end),
          created_at_iso: toIso(r.created_at)
        }))
        const targetOutages = rawTargetOutages.map(r => ({
          start: toMs(r.start),
          host: r.host,
          end: r.end == null ? null : toMs(r.end),
          duration_ms: normalizeDurationMs(r.duration_ms),
          uptime_before_ms: normalizeDurationMs(r.uptime_before_ms),
          outage_type: r.outage_type,
          ongoing: r.ongoing,
          created_at: toMs(r.created_at),
          start_iso: toIso(r.start),
          end_iso: r.end == null ? null : toIso(r.end),
          created_at_iso: toIso(r.created_at)
        }))
    const counts = {
      network_outages: db.get('SELECT COUNT(*) as c FROM network_outages').c,
      target_outages: db.get('SELECT COUNT(*) as c FROM target_outages').c,
      audit_internet_checks: db.get("SELECT COUNT(*) as c FROM audit_log WHERE event = 'internet.check'").c,
      audit_internet_down_up: db.get("SELECT COUNT(*) as c FROM audit_log WHERE event IN ('internet.down','internet.up')").c,
    }
    // detect any rows with start in seconds
    const legacyNetwork = db.get('SELECT COUNT(*) as c FROM network_outages WHERE start < ?', [1e12]).c
    const legacyTarget = db.get('SELECT COUNT(*) as c FROM target_outages WHERE start < ?', [1e12]).c
    // Normalize recentChecks and recentEvents payloads and add ISO timestamps
    const normalizedChecks = recentChecks.map(r => {
      let p = r.payload
      try { p = typeof p === 'string' ? JSON.parse(p) : p } catch { p = r.payload }
      return { ts: Number(r.ts), ts_iso: toIso(r.ts), payload: p }
    })
    const normalizedEvents = recentEvents.map(r => {
      let p = r.payload
      try { p = typeof p === 'string' ? JSON.parse(p) : p } catch { p = r.payload }
      return { ts: Number(r.ts), ts_iso: toIso(r.ts), event: r.event, payload: p }
    })

    res.json({ ok: true, counts, legacy: { network: legacyNetwork, target: legacyTarget }, networkOutages, targetOutages, recentChecks: normalizedChecks, recentEvents: normalizedEvents })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PDF export: a clinical-looking report for outage inspector
router.get('/outage-inspector.pdf', (req, res) => {
  try {
    const db = getDb()
    const rawNetworkOutages = db.all('SELECT start,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM network_outages ORDER BY start DESC LIMIT 200')
    const rawTargetOutages = db.all('SELECT start,host,end,duration_ms,uptime_before_ms,outage_type,ongoing,created_at FROM target_outages ORDER BY start DESC LIMIT 500')
    const toMs = (v) => { if (v == null) return null; const n = Number(v); if (!isFinite(n)) return null; return n < 1e12 ? Math.round(n * 1000) : Math.round(n) }
    const normalizeDurationMs = (v) => { if (v == null) return null; const n = Number(v); if (!isFinite(n)) return null; if (n > 0 && n < 1e5) return Math.round(n * 1000); return Math.round(n) }
    const fmtDur = (ms) => { if (ms == null) return '—'; const s = Math.round(ms/1000); if (s < 60) return `${s}s`; const m = Math.floor(s/60); return `${m}m ${s%60}s` }

    const networkOutages = rawNetworkOutages.map(r => ({ start: toMs(r.start), end: r.end==null?null:toMs(r.end), duration_ms: normalizeDurationMs(r.duration_ms), uptime_before_ms: normalizeDurationMs(r.uptime_before_ms), outage_type: r.outage_type, ongoing: r.ongoing }))
    const targetOutages = rawTargetOutages.map(r => ({ start: toMs(r.start), host: r.host, end: r.end==null?null:toMs(r.end), duration_ms: normalizeDurationMs(r.duration_ms), uptime_before_ms: normalizeDurationMs(r.uptime_before_ms), outage_type: r.outage_type, ongoing: r.ongoing }))

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="outage-inspector.pdf"')

    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    doc.pipe(res)
    doc.fontSize(14).font('Helvetica-Bold').text('Outage Inspector Report', { align: 'center' })
    doc.moveDown(0.5)
    doc.fontSize(9).font('Helvetica').text(`Generated: ${new Date().toISOString()}`, { align: 'center' })
    doc.moveDown(1)

    // Summary
    doc.fontSize(10).font('Helvetica-Bold').text('Summary')
    const counts = {
      network_outages: db.get('SELECT COUNT(*) as c FROM network_outages').c,
      target_outages: db.get('SELECT COUNT(*) as c FROM target_outages').c
    }
    doc.fontSize(9).font('Helvetica').text(`Network outages: ${counts.network_outages}    Target outages: ${counts.target_outages}`)
    doc.moveDown(0.8)

    // Network outages table (compact)
    doc.fontSize(10).font('Helvetica-Bold').text('Recent network_outages')
    doc.moveDown(0.2)
    doc.font('Courier').fontSize(8)
    const nwHeader = `${'start'.padEnd(24)} ${'end'.padEnd(24)} ${'dur'.padStart(8)} ${'uptime'.padStart(10)} ${'type'.padEnd(10)} ${'ongoing'}`
    doc.text(nwHeader)
    doc.moveDown(0.1)
    networkOutages.forEach(r => {
      const line = `${(r.start?new Date(r.start).toISOString():'—').padEnd(24)} ${(r.end?new Date(r.end).toISOString():'—').padEnd(24)} ${fmtDur(r.duration_ms).padStart(8)} ${fmtDur(r.uptime_before_ms).padStart(10)} ${String(r.outage_type||'—').padEnd(10)} ${r.ongoing? 'yes':'no'}`
      doc.text(line)
    })
    doc.addPage()

    doc.fontSize(10).font('Helvetica-Bold').text('Recent target_outages')
    doc.moveDown(0.2)
    doc.font('Courier').fontSize(8)
    const tgtHeader = `${'start'.padEnd(24)} ${'host'.padEnd(30)} ${'end'.padEnd(24)} ${'dur'.padStart(8)} ${'uptime'.padStart(10)} ${'ongoing'}`
    doc.text(tgtHeader)
    doc.moveDown(0.1)
    targetOutages.forEach(r => {
      const line = `${(r.start?new Date(r.start).toISOString():'—').padEnd(24)} ${String(r.host||'—').padEnd(30)} ${(r.end?new Date(r.end).toISOString():'—').padEnd(24)} ${fmtDur(r.duration_ms).padStart(8)} ${fmtDur(r.uptime_before_ms).padStart(10)} ${r.ongoing? 'yes':'no'}`
      doc.text(line)
    })

    doc.end()
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
