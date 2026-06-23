import { expect, test } from 'vitest'
import { filterEventForSweep } from '../src/routes/stream.js'

test('events with a sweepId only pass to the matching sweep (social + photo)', () => {
  expect(filterEventForSweep({ type: 'support', sweepId: 'a', fixtureId: 'm0' }, 'a')).toBe(true)
  expect(filterEventForSweep({ type: 'support', sweepId: 'a', fixtureId: 'm0' }, 'b')).toBe(false)
  expect(filterEventForSweep({ type: 'photo-pending', sweepId: 'a' }, 'a')).toBe(true)
  expect(filterEventForSweep({ type: 'photo-pending', sweepId: 'a' }, 'b')).toBe(false)
})

test('events without a sweepId (match events) pass to everyone', () => {
  expect(filterEventForSweep({ type: 'goal', fixtureId: 'm0' }, 'a')).toBe(true)
  expect(filterEventForSweep({ type: 'score', fixtureId: 'm0' }, 'b')).toBe(true)
})
