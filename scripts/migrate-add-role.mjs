import { execSync } from 'child_process'
import path from 'path'

const DB = path.join(process.cwd(), 'output', 'claudette.db')
console.log('DB:', DB)

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

try {
  const cols = run(`sqlite3 "${DB}" "PRAGMA table_info(users);" || true`)
  if (!cols) {
    console.error('Could not read users table. Is the DB present at', DB)
    process.exit(1)
  }
  if (cols.indexOf('role') !== -1) {
    console.log('role column already present — nothing to do')
    process.exit(0)
  }

  console.log('Adding role column (TEXT) to users table')
  run(`sqlite3 "${DB}" "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';"`)

  // Promote any existing user named 'admin' to role 'admin'
  console.log("Setting role='admin' for username='admin' if present")
  run(`sqlite3 "${DB}" "UPDATE users SET role='admin' WHERE username='admin';"`)

  // Ensure at least one admin exists; if none, promote the first user
  const adminCount = run(`sqlite3 "${DB}" "SELECT COUNT(*) FROM users WHERE role='admin';"`)
  if (Number(adminCount) === 0) {
    console.log('No admin found — promoting first user to admin')
    run(`sqlite3 "${DB}" "UPDATE users SET role='admin' WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1);"`)
  }

  console.log('Migration complete')
} catch (e) {
  console.error('Migration failed:', e.message)
  process.exit(1)
}
