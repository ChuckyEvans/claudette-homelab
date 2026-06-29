#!/usr/bin/env node
import bcrypt from 'bcryptjs'
import { createUser, findUserByUsername } from '../server/db.js'
const username = process.argv[2] || 'testuser'
const password = process.argv[3] || 'password123'
if (findUserByUsername(username)) {
  console.log('User already exists:', username)
  process.exit(0)
}
const hash = await bcrypt.hash(password, 12)
createUser(username, hash)
console.log('Created user', username)