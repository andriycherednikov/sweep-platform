import { expect, test } from 'vitest'
import { newToken } from '../src/sweeps/tokens.js'

test('newToken returns a 22-char base62 string', () => {
  const t = newToken()
  expect(t).toMatch(/^[0-9A-Za-z]{22}$/)
})

test('newToken is unique across many calls', () => {
  const set = new Set(Array.from({ length: 1000 }, () => newToken()))
  expect(set.size).toBe(1000)
})
