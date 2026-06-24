import { expect, test, beforeEach } from 'vitest'
import { toggleLeg, removeLeg, clearBetslip, hasLeg, betslipLegs, betslipCount, combinedOdds } from './betslip.js'

const leg = (over = {}) => ({ fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2, line: null, book: 'Pinnacle', label: 'Home', ...over })

beforeEach(() => clearBetslip())

test('toggleLeg adds, and toggling the same selection removes it', () => {
  toggleLeg(leg())
  expect(betslipCount()).toBe(1)
  expect(hasLeg('f1', '1x2', 'HOME')).toBe(true)
  toggleLeg(leg())
  expect(betslipCount()).toBe(0)
})

test('same-game multi — a different market on the same fixture adds a second leg', () => {
  toggleLeg(leg())
  toggleLeg(leg({ market: 'ou25', selection: 'OVER', odds: 1.9, label: 'Over 2.5' }))
  expect(betslipCount()).toBe(2)
  expect(hasLeg('f1', '1x2', 'HOME')).toBe(true)
  expect(hasLeg('f1', 'ou25', 'OVER')).toBe(true)
})

test('one leg per (fixture, market) — a different selection on the same market replaces it', () => {
  toggleLeg(leg({ market: 'oe', selection: 'ODD', odds: 1.95, label: 'Odd' }))
  toggleLeg(leg({ market: 'oe', selection: 'EVEN', odds: 1.9, label: 'Even' }))
  expect(betslipCount()).toBe(1)
  expect(hasLeg('f1', 'oe', 'ODD')).toBe(false)
  expect(hasLeg('f1', 'oe', 'EVEN')).toBe(true)
})

test('combinedOdds multiplies the legs; removeLeg drops a single leg by full key', () => {
  toggleLeg(leg())                               // 2
  toggleLeg(leg({ fixtureId: 'f2', odds: 1.9 })) // ×1.9
  expect(combinedOdds()).toBeCloseTo(3.8, 5)
  removeLeg('f1', '1x2', 'HOME')
  expect(betslipCount()).toBe(1)
  expect(betslipLegs()[0].fixtureId).toBe('f2')
})

test('removeLeg removes only the targeted same-game leg, not every leg on the fixture', () => {
  toggleLeg(leg())                                                  // f1 1x2 HOME
  toggleLeg(leg({ market: 'ou25', selection: 'OVER', odds: 1.9 }))  // f1 ou25 OVER
  removeLeg('f1', '1x2', 'HOME')
  expect(betslipCount()).toBe(1)
  expect(hasLeg('f1', 'ou25', 'OVER')).toBe(true)
})
