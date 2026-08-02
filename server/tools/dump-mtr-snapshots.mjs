#!/usr/bin/env node
import { getDb } from '../db.js'
const db = getDb()
const rows = db.all('SELECT ts, type, outage_ts, length(output) as olen, captured_at FROM mtr_snapshots ORDER BY ts DESC LIMIT 10')
console.log(JSON.stringify(rows, null, 2))
if (rows && rows.length > 0) {
	const first = db.get('SELECT ts, type, outage_ts, substr(output,1,1000) as sample FROM mtr_snapshots ORDER BY ts DESC LIMIT 1')
	console.log('\n--- latest snapshot sample ---')
	console.log(first.sample)
}
