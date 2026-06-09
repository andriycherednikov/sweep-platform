import bcrypt from 'bcryptjs'

const passcode = process.argv[2]
if (!passcode) { console.error('usage: npm run admin:hash -w api -- <passcode>'); process.exit(1) }
console.log(bcrypt.hashSync(passcode, 10))
