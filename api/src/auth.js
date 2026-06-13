import bcrypt from 'bcryptjs'

export function verifyPasscode(passcode, hash) {
  if (!hash || !passcode) return false
  try { return bcrypt.compareSync(passcode, hash) } catch { return false }
}
