import { expect, test } from 'vitest'
import { parseSuperRoute } from './superRoute.js'

test('bare /super is a super route with no auto-submit token', () => {
  expect(parseSuperRoute('/super')).toEqual({ isSuper: true, token: null })
})

test('/super/<token> is a super route yielding the token to auto-submit', () => {
  expect(parseSuperRoute('/super/abc123XYZ')).toEqual({ isSuper: true, token: 'abc123XYZ' })
})

test('trailing slash on /super/ is a super route with no token', () => {
  expect(parseSuperRoute('/super/')).toEqual({ isSuper: true, token: null })
})

test('a non-super path is not a super route and yields no token', () => {
  expect(parseSuperRoute('/teams/ar')).toEqual({ isSuper: false, token: null })
})

test('the app root is not a super route', () => {
  expect(parseSuperRoute('/')).toEqual({ isSuper: false, token: null })
})

test('extra trailing segments are ignored — only the first token segment is used', () => {
  expect(parseSuperRoute('/super/tok/extra')).toEqual({ isSuper: true, token: 'tok' })
})
