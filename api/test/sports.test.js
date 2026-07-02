import { test, expect } from 'vitest'
import { SPORTS, sportConfig } from '../src/sports.js'

test('football has draws, basketball does not', () => {
  expect(SPORTS.football.hasDraws).toBe(true)
  expect(SPORTS.basketball.hasDraws).toBe(false)
})

test('sportConfig throws on unknown sport', () => {
  expect(() => sportConfig('curling')).toThrow(/unknown sport/)
  expect(sportConfig('football')).toEqual({ hasDraws: true })
})
