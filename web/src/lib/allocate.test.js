import { expect, test } from 'vitest'
import { allocateRandomForPerson, mulberry32 } from './allocate.js'

const TEAMS = [{ code: 'ar' }, { code: 'br' }, { code: 'fr' }, { code: 'de' }, { code: 'es' }]

test('mulberry32 is deterministic for a given seed', () => {
  const a = mulberry32(42), b = mulberry32(42)
  expect([a(), a(), a()]).toEqual([b(), b(), b()])
})

test('never returns a team the person already owns', () => {
  const person = { teams: ['ar', 'br'] }
  const got = allocateRandomForPerson(person, 5, TEAMS, {}, mulberry32(1))
  expect(got).not.toContain('ar')
  expect(got).not.toContain('br')
  expect(got.sort()).toEqual(['de', 'es', 'fr'])
})

test('returns min(count, available) distinct codes', () => {
  const got = allocateRandomForPerson({ teams: [] }, 2, TEAMS, {}, mulberry32(7))
  expect(got).toHaveLength(2)
  expect(new Set(got).size).toBe(2)
  // owns-all-but-one + ask for 3 → only 1 available
  const got2 = allocateRandomForPerson({ teams: ['ar', 'br', 'fr', 'de'] }, 3, TEAMS, {}, mulberry32(7))
  expect(got2).toEqual(['es'])
})

test('prefers least-owned teams (even spread)', () => {
  // de is unowned (0), everything else heavily owned → de must be picked first
  const ownerCounts = { ar: 5, br: 5, fr: 5, de: 0, es: 5 }
  const got = allocateRandomForPerson({ teams: [] }, 1, TEAMS, ownerCounts, mulberry32(3))
  expect(got).toEqual(['de'])
})

test('accepts a Map for ownerCounts', () => {
  const ownerCounts = new Map([['ar', 9], ['br', 0]])
  const got = allocateRandomForPerson({ teams: [] }, 1, [{ code: 'ar' }, { code: 'br' }], ownerCounts, mulberry32(3))
  expect(got).toEqual(['br'])
})

test('deterministic under a seeded rng', () => {
  const a = allocateRandomForPerson({ teams: [] }, 3, TEAMS, {}, mulberry32(99))
  const b = allocateRandomForPerson({ teams: [] }, 3, TEAMS, {}, mulberry32(99))
  expect(a).toEqual(b)
})

test('edge cases: count<=0, empty list, owns-all → []', () => {
  expect(allocateRandomForPerson({ teams: [] }, 0, TEAMS, {}, mulberry32(1))).toEqual([])
  expect(allocateRandomForPerson({ teams: [] }, -2, TEAMS, {}, mulberry32(1))).toEqual([])
  expect(allocateRandomForPerson({ teams: [] }, 3, [], {}, mulberry32(1))).toEqual([])
  expect(allocateRandomForPerson({ teams: ['ar', 'br', 'fr', 'de', 'es'] }, 3, TEAMS, {}, mulberry32(1))).toEqual([])
})
