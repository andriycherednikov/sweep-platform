import { test, expect } from 'vitest'
import { resolveBet } from '../src/wagering/markets.js'
import { SPORTS } from '../src/sports.js'

const nba = SPORTS.basketball, foot = SPORTS.football
// flattened-event shape: final NBA game 110-104 (final score incl. OT)
const g = { status: 'final', t1Code: 'BOS', t2Code: 'DAL', score1: 110, score2: 104, winnerCode: 'BOS', regScore1: null, regScore2: null }

test('ml grades on the final result, OT included', () => {
  expect(resolveBet('ml', 'HOME', null, g, nba)).toBe('won')
  expect(resolveBet('ml', 'AWAY', null, g, nba)).toBe('lost')
  expect(resolveBet('ml', 'HOME', null, { ...g, score1: null, score2: null, winnerCode: null }, nba)).toBe(null) // not final yet
})

test('ou grades total vs the stored half-point line per gradeOn', () => {
  expect(resolveBet('ou', 'OVER', 213.5, g, nba)).toBe('won')   // 214 > 213.5
  expect(resolveBet('ou', 'UNDER', 213.5, g, nba)).toBe('lost')
  expect(resolveBet('ou', 'OVER', 214.5, g, nba)).toBe('lost')
  expect(resolveBet('ou', 'OVER', null, g, nba)).toBe(null)
  // integer line landing exactly on the total → push, left open (half lines only at offer)
  expect(resolveBet('ou', 'OVER', 214, g, nba)).toBe(null)
  // football grades regulation, not final: reg 1-1, final 2-1 after ET
  const f = { ...g, score1: 2, score2: 1, regScore1: 1, regScore2: 1 }
  expect(resolveBet('ou', 'OVER', 2.5, f, foot)).toBe('lost')   // reg total 2
})

test('hcap grades home-relative line', () => {
  expect(resolveBet('hcap', 'HOME', -5.5, g, nba)).toBe('won')  // 110-5.5 > 104
  expect(resolveBet('hcap', 'HOME', -6.5, g, nba)).toBe('lost')
  expect(resolveBet('hcap', 'AWAY', -6.5, g, nba)).toBe('won')
  expect(resolveBet('hcap', 'AWAY', -6, g, nba)).toBe(null)     // exact push → left open
})

test('draw markets never grade for a no-draw sport (belt)', () => {
  expect(resolveBet('1x2', 'HOME', null, { ...g, regScore1: 110, regScore2: 104 }, nba)).toBe(null)
  expect(resolveBet('dc', '1X', null, { ...g, regScore1: 110, regScore2: 104 }, nba)).toBe(null)
})
