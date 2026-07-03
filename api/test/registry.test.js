import { test, expect } from 'vitest'
import { providerFor, sportOf } from '../src/providers/registry.js'

test('providerFor returns the right adapter per provider key, cached', () => {
  const fb = providerFor({ provider: 'apifootball' }, { apiKey: 'k' })
  expect(fb.sport).toBe('football')
  expect(fb.live).toBe(true) // explicit flag — the worker's live-tick gate reads this
  expect(fb.fetchLive).toBeUndefined() // dead capability marker removed (pollLive uses fetchResults)
  const bb = providerFor({ provider: 'apibasketball' }, { apiKey: 'k' })
  expect(bb.sport).toBe('basketball')
  expect(bb.live).toBeUndefined()
  expect(providerFor({ provider: 'apifootball' }, { apiKey: 'k' })).toBe(fb) // cached
  expect(() => providerFor({ provider: 'espn' }, { apiKey: 'k' })).toThrow(/unknown provider/)
})

test('sportOf maps provider keys to sports', () => {
  expect(sportOf('apifootball')).toBe('football')
  expect(sportOf('apibasketball')).toBe('basketball')
  expect(() => sportOf('espn')).toThrow(/unknown provider/)
})
