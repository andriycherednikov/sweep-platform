import { expect, test, beforeEach } from 'vitest'
import { isOptedOut, optOut, OPT_OUT_DAYS } from './optout.js'

beforeEach(() => {
  localStorage.clear()
})

test('not opted out by default', () => {
  expect(isOptedOut()).toBe(false)
})

test('optOut(7d) opts out and stores a future expiry roughly 7 days out', () => {
  const before = Date.now()
  optOut('7d')
  expect(isOptedOut()).toBe(true)
  const raw = Number(localStorage.getItem('sweep.wagers.optout.v1'))
  const sevenDays = OPT_OUT_DAYS['7d'] * 86_400_000
  expect(raw).toBeGreaterThanOrEqual(before + sevenDays - 1000)
  expect(raw).toBeLessThanOrEqual(Date.now() + sevenDays + 1000)
})

test('an expired timestamp reads as not opted out (silent lift)', () => {
  localStorage.setItem('sweep.wagers.optout.v1', String(Date.now() - 1000))
  expect(isOptedOut()).toBe(false)
})

test('optOut(forever) is opted out indefinitely', () => {
  optOut('forever')
  expect(localStorage.getItem('sweep.wagers.optout.v1')).toBe('forever')
  expect(isOptedOut()).toBe(true)
})

test('an unknown duration key is ignored (no lockout)', () => {
  optOut('bogus')
  expect(isOptedOut()).toBe(false)
})
