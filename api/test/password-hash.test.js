import { expect, test } from 'vitest'
import { hashPassword, verifyPassword, DUMMY_HASH } from '../src/auth.js'

test('a hash verifies its own password and nothing else', async () => {
  const h = await hashPassword('correct horse battery')
  expect(await verifyPassword('correct horse battery', h)).toBe(true)
  expect(await verifyPassword('wrong horse battery', h)).toBe(false)
})

// bcrypt silently truncates past 72 bytes, so two different long passwords would
// otherwise be the same credential. Reject rather than truncate.
test('a password over 72 bytes is refused, not silently truncated', async () => {
  await expect(hashPassword('a'.repeat(73))).rejects.toThrow(/72/)
})

// The login handler compares against this when no usable hash exists, so an address
// with no account costs the same time as one with a password.
test('DUMMY_HASH is a real bcrypt hash that matches nothing', async () => {
  expect(DUMMY_HASH).toMatch(/^\$2[aby]\$/)
  expect(await verifyPassword('anything', DUMMY_HASH)).toBe(false)
})
