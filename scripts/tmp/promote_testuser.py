#!/usr/bin/env python3
import sqlite3
db='/var/lib/docker/volumes/claudette-data/_data/claudette.db'
con=sqlite3.connect(db)
cur=con.cursor()
hash='$2b$10$5mnDzCasWQ8Df7CXweP0LOhUyOIdmFHSmNvJgPtbf2fXwnTXEXjYW'
cur.execute("UPDATE users SET role='admin', password_hash=? WHERE username='testuser'", (hash,))
con.commit()
cur.execute("SELECT id,username,role,length(password_hash) FROM users WHERE username='testuser' LIMIT 1;")
row=cur.fetchone()
print(row if row else 'NO-ROW')
con.close()
