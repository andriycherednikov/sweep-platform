import { expect, test } from 'vitest'
import { serializeParlay } from '../src/coins/ledger.js'

test('serializeParlay nests serialized legs and exposes parent money fields', () => {
  const p = { id: 'par_1', stake: 100, combinedOdds: '7.6', potentialPayout: 760, status: 'open', placedAt: 'T', settledAt: null }
  const legs = [
    { id: 'b1', fixtureId: 'f1', market: '1x2', selection: 'HOME', line: null, stake: 0, oddsDecimal: '2', book: 'Pinnacle', potentialPayout: 0, status: 'open', placedAt: 'T', settledAt: null },
    { id: 'b2', fixtureId: 'f2', market: 'ou25', selection: 'OVER', line: '2.5', stake: 0, oddsDecimal: '1.9', book: 'Pinnacle', potentialPayout: 0, status: 'won', placedAt: 'T', settledAt: 'T' },
  ]
  const out = serializeParlay(p, legs)
  expect(out).toMatchObject({ id: 'par_1', stake: 100, combinedOdds: 7.6, potentialPayout: 760, status: 'open' })
  expect(out.legs).toHaveLength(2)
  expect(out.legs[0]).toMatchObject({ fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2 })
  expect(out.legs[1]).toMatchObject({ fixtureId: 'f2', market: 'ou25', selection: 'OVER', odds: 1.9, line: 2.5, status: 'won' })
})
