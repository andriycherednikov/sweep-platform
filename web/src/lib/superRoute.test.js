import { expect, test } from 'vitest'
import { parseSuperRoute } from './superRoute.js'

test('bare /super has no auto-submit token', () => {
  expect(parseSuperRoute('/super')).toEqual({ token: null })
})

test('/super/<token> yields the token to auto-submit', () => {
  expect(parseSuperRoute('/super/abc123XYZ')).toEqual({ token: 'abc123XYZ' })
})

test('trailing slash on /super/ is treated as no token', () => {
  expect(parseSuperRoute('/super/')).toEqual({ token: null })
})

test('a non-super path yields no token', () => {
  expect(parseSuperRoute('/teams/ar')).toEqual({ token: null })
})

test('extra trailing segments are ignored — only the first token segment is used', () => {
  expect(parseSuperRoute('/super/tok/extra')).toEqual({ token: 'tok' })
})
