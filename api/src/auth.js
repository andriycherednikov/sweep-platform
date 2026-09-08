import bcrypt from 'bcryptjs'

export function verifyPasscode(passcode, hash) {
  if (!hash || !passcode) return false
  try { return bcrypt.compareSync(passcode, hash) } catch { return false }
}

const ROUNDS = 10
/** bcrypt truncates silently past 72 bytes — two different long passwords would hash
 *  identically, so the cap is a correctness rule, not a policy preference. */
export const MAX_PASSWORD_BYTES = 72

export async function hashPassword(plain) {
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`password must be at most ${MAX_PASSWORD_BYTES} bytes`)
  }
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain, hash) {
  if (!hash || !plain) return false
  try { return await bcrypt.compare(plain, hash) } catch { return false }
}

/** Compared against when no usable hash exists, so response timing cannot be used to
 *  discover which addresses have accounts. */
export const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.PHkQm9k9tE2/YHRlqPNL0AQmM1Xu'
