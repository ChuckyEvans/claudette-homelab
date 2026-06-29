BEGIN TRANSACTION;
DELETE FROM users WHERE username='testuser';
INSERT INTO users (username,password_hash,created_at,role) VALUES ('testuser','$2b$12$lqWPfq4rbmT1cYY16XrkVuUT5XVXzv/CzkGVxUfsRkBT8aGcdreO6', strftime('%s','now'), 'admin');
COMMIT;
