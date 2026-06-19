import { expect, test, beforeEach } from 'vitest'
import { isOptedOut, optOut, OPT_OUT_DAYS } from './optout.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  localStorage.clear()
  S.people = [{ id: 'pn_a', name: 'Ann' }, { id: 'pn_b', name: 'Bob' }]
  setMe('pn_a')
})

test('not opted out by default', () => {
  expect(isOptedOut()).toBe(false)
  expect(isOptedOut('pn_a')).toBe(false)
})

test('optOut(7d) opts out the current person with a future expiry ~7 days out', () => {
  const before = Date.now()
  optOut('7d')
  expect(isOptedOut()).toBe(true)
  const map = JSON.parse(localStorage.getItem('sweep.wagers.optout.v2'))
  const sevenDays = OPT_OUT_DAYS['7d'] * 86_400_000
  expect(map.pn_a).toBeGreaterThanOrEqual(before + sevenDays - 1000)
  expect(map.pn_a).toBeLessThanOrEqual(Date.now() + sevenDays + 1000)
})

test('opt-out is per-person — only the chosen identity is locked', () => {
  optOut('7d', 'pn_a')
  expect(isOptedOut('pn_a')).toBe(true)
  expect(isOptedOut('pn_b')).toBe(false)
  // switching identity reflects the other person's (clean) state
  setMe('pn_b')
  expect(isOptedOut()).toBe(false)
  setMe('pn_a')
  expect(isOptedOut()).toBe(true)
})

test('an expired timestamp reads as not opted out (silent lift)', () => {
  localStorage.setItem('sweep.wagers.optout.v2', JSON.stringify({ pn_a: Date.now() - 1000 }))
  expect(isOptedOut('pn_a')).toBe(false)
})

test('optOut(forever) is opted out indefinitely', () => {
  optOut('forever', 'pn_a')
  expect(JSON.parse(localStorage.getItem('sweep.wagers.optout.v2')).pn_a).toBe('forever')
  expect(isOptedOut('pn_a')).toBe(true)
})

test('an unknown duration key is ignored (no lockout)', () => {
  optOut('bogus', 'pn_a')
  expect(isOptedOut('pn_a')).toBe(false)
})

test('no identity → never opted out, optOut is a no-op', () => {
  setMe(null)
  optOut('7d')
  expect(isOptedOut()).toBe(false)
})
