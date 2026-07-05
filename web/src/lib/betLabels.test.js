import { describe, it, expect, beforeEach } from 'vitest'
import { RENDERABLE_MARKETS, MARKET_LABELS, betSelectionLabel } from './betLabels.js'
import { setSweepData } from '../data.js'
import { assembleSweep } from './assemble.js'
import { makeApi, makeFixture } from '../../test/factories.js'

const NBA_MARKETS = {
  ml: { label: 'Moneyline', book: 'B', selections: [{ key: 'HOME', label: 'Home', odds: 1.6 }, { key: 'AWAY', label: 'Away', odds: 2.3 }] },
  ou: { label: 'Total Points', line: 220.5, book: 'B', selections: [{ key: 'OVER', label: 'Over', odds: 1.9 }, { key: 'UNDER', label: 'Under', odds: 1.9 }] },
  hcap: { label: 'Handicap', line: -4.5, book: 'B', selections: [{ key: 'HOME', label: 'Home', odds: 1.9 }, { key: 'AWAY', label: 'Away', odds: 1.9 }] },
}
beforeEach(() => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball',
    fixtures: [makeFixture({ id: 'g1', t1: 'lal', t2: 'bos', group: '', matchday: 0, markets: NBA_MARKETS })] })))
})
it('labels the generic spine', () => {
  expect(MARKET_LABELS.ml).toBe('Moneyline'); expect(MARKET_LABELS.ou).toBe('Over/Under'); expect(MARKET_LABELS.hcap).toBe('Handicap')
  expect(RENDERABLE_MARKETS).toEqual(expect.arrayContaining(['ml', 'ou', 'hcap', '1x2', 'toq', 'ou25']))
})
it('selection wording: team names, O/U line, signed handicap', () => {
  expect(betSelectionLabel({ market: 'ml', selection: 'HOME', fixtureId: 'g1' })).toBe('Lakers')
  expect(betSelectionLabel({ market: 'ou', selection: 'OVER', fixtureId: 'g1', line: 220.5 })).toBe('Over 220.5')
  expect(betSelectionLabel({ market: 'hcap', selection: 'HOME', fixtureId: 'g1', line: -4.5 })).toBe('Lakers -4.5')
  expect(betSelectionLabel({ market: 'hcap', selection: 'AWAY', fixtureId: 'g1', line: -4.5 })).toBe('Celtics +4.5')
})
