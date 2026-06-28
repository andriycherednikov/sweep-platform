import { expect, test } from 'vitest'
import { serializeFixture } from '../src/serialize.js'

const base = {
  id: 'm1', group: 'A', matchday: 1, t1Code: 'ar', t2Code: 'mx',
  kickoffUtc: new Date('2026-06-13T06:30:00Z'), venue: 'V', city: 'C', status: 'live',
  score1: 1, score2: 0, minute: 63, probA: 50, probD: 25, probB: 25,
  lineups: null, stage: 'group', derby: false, doubleOwner: false,
}

test('serializeFixture passes events through', () => {
  const events = [{ id: 'x', type: 'goal', teamCode: 'ar', player: 'Messi', minute: 23, detail: 'Normal Goal', assist: null }]
  expect(serializeFixture({ ...base, events }).events).toEqual(events)
})

test('serializeFixture coerces null events to an empty array', () => {
  expect(serializeFixture({ ...base, events: null }).events).toEqual([])
})

test('serializeFixture passes statistics through, null when absent', () => {
  const statistics = { ar: { shotsOnGoal: 5, totalShots: 12, corners: 7, possession: '58%', fouls: 9 } }
  expect(serializeFixture({ ...base, statistics }).statistics).toEqual(statistics)
  expect(serializeFixture({ ...base }).statistics).toBeNull()
})

test('serializeFixture exposes markets and half-time score', () => {
  const markets = { '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 2 }] } }
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'final', score1: 2, score2: 1, minute: null,
    probA: 50, probD: 25, probB: 25, markets, htScore1: 1, htScore2: 0,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.markets).toEqual(markets)
  expect(out.htScore).toEqual([1, 0])
})

test('serializeFixture markets null + htScore null when absent', () => {
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'upcoming', score1: null, score2: null, minute: null,
    probA: null, probD: null, probB: null, markets: null, htScore1: null, htScore2: null,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.markets).toBeNull()
  expect(out.htScore).toBeNull()
})

test('serializeFixture exposes winnerCode, null when absent', () => {
  const out1 = serializeFixture({ ...base, winnerCode: 'ar' })
  expect(out1.winnerCode).toBe('ar')
  const out2 = serializeFixture({ ...base })
  expect(out2.winnerCode).toBeNull()
})

