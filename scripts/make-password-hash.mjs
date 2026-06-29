import bcrypt from 'bcryptjs'
const pw = process.argv[2] || 'password123'
const rounds = 12
bcrypt.hash(pw, rounds).then(h => console.log(h)).catch(e => { console.error(e); process.exit(2) })
