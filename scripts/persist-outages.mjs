import { persistOutages, persistTargetOutages } from '../server/db.js'

const n = persistOutages()
console.log('persistOutages ->', n, 'outages processed')
const tn = persistTargetOutages()
console.log('persistTargetOutages ->', tn, 'target outages processed')

// Print counts
import { getDb } from '../server/db.js'
const db = getDb()
const no = db.get('SELECT COUNT(*) AS n FROM network_outages').n
const to = db.get('SELECT COUNT(*) AS n FROM target_outages').n
console.log('network_outages rows:', no)
console.log('target_outages rows:', to)
