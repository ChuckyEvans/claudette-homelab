UPDATE users SET role='admin', password_hash='$2b$10$5mnDzCasWQ8Df7CXweP0LOhUyOIdmFHSmNvJgPtbf2fXwnTXEXjYW' WHERE username='testuser';
SELECT id,username,role,length(password_hash) FROM users WHERE username='testuser' LIMIT 1;
