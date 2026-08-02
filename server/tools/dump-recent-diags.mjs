#!/usr/bin/env node
import { getDb } from '../db.js'
const db = getDb()
const rows = db.all('SELECT outage_ts, traceroute_last_hop, length(traceroute) as tlen, captured_at FROM outage_diagnostics ORDER BY captured_at DESC LIMIT 10')
console.log(JSON.stringify(rows, null, 2))
