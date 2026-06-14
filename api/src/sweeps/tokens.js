import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Unguessable 22-char base62 capability token (~131 bits). */
export function newToken(len = 22) {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 62]
  return out
}
