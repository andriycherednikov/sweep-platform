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
