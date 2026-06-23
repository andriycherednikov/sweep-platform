import { expect, test } from 'vitest'
import { createBus } from '../src/events/bus.js'

test('subscribers receive published events; unsubscribe stops delivery', () => {
  const bus = createBus()
  const seen = []
  const unsub = bus.subscribe((e) => seen.push(e))
  bus.publish({ type: 'support', fixtureId: '1' })
  bus.publish({ type: 'score', fixtureId: '2' })
  unsub()
  bus.publish({ type: 'support', fixtureId: '3' })
  expect(seen).toEqual([{ type: 'support', fixtureId: '1' }, { type: 'score', fixtureId: '2' }])
})

test('multiple subscribers all receive the same event', () => {
  const bus = createBus()
  const a = [], b = []
  bus.subscribe((e) => a.push(e))
  bus.subscribe((e) => b.push(e))
  bus.publish({ type: 'sync' })
  expect(a).toEqual([{ type: 'sync' }])
  expect(b).toEqual([{ type: 'sync' }])
})
