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

test('serializeFixture exposes decimal odds + book', () => {
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'upcoming', score1: null, score2: null, minute: null,
    probA: 50, probD: 25, probB: 25, oddsHome: '2.10', oddsDraw: '3.30', oddsAway: '3.80', oddsBook: 'Pinnacle',
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.odds).toEqual({ home: 2.1, draw: 3.3, away: 3.8, book: 'Pinnacle' })
})

test('serializeFixture odds is null when no odds were captured', () => {
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'upcoming', score1: null, score2: null, minute: null,
    probA: null, probD: null, probB: null, oddsHome: null, oddsDraw: null, oddsAway: null, oddsBook: null,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.odds).toBeNull()
})
