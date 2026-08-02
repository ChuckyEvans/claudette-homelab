import { getDb } from '../server/db.js'
import { computeOutagesSummary, loadInternetCheckRows, computeWeightedInternetUptime } from '../server/lib/outages.mjs'

const db = getDb()
const to = Date.now()
const from = to - 7*24*60*60*1000

const summary = computeOutagesSummary(db, from, to)
const checks = loadInternetCheckRows(db, from, to)
const uptime = computeWeightedInternetUptime(checks, from, to)

console.log(JSON.stringify({ from, to, uptimePct: uptime, outagesSummary: summary, checksCount: checks.length }, null, 2))
