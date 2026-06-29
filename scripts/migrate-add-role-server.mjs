import { getDb, getDbPath } from '../server/db.js'

async function main() {
  const db = getDb()
  const dbPath = getDbPath()
  console.log('Opening DB at', dbPath)

  const cols = db.all("PRAGMA table_info(users);")
  const colNames = cols.map(c => c.name)
  if (colNames.includes('role')) {
    console.log('role column already exists — nothing to do')
    return
  }

  console.log('Adding role column to users table')
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';")

  console.log("Promoting username='admin' to role='admin' if present")
  db.exec("UPDATE users SET role='admin' WHERE username='admin';")

  const adminCount = db.get("SELECT COUNT(*) as c FROM users WHERE role='admin';").c
  if (adminCount === 0) {
    console.log('No admin found — promoting first user to admin')
    db.exec("UPDATE users SET role='admin' WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1);")
  }

  console.log('Migration complete')
}

main().catch(e => { console.error(e); process.exit(1) })
