import { getDb } from '../db.js'

const db = getDb()
const tables = db.all("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
console.log(JSON.stringify(tables, null, 2))
