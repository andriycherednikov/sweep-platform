import { test, expect } from 'vitest'
import { providerFor, sportOf, PROVIDER_KEYS, seasonInWindow } from '../src/providers/registry.js'

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

test('providerFor keys the cache by apiKey too (multi-tenant keys must not collide)', () => {
  const a = providerFor({ provider: 'apifootball' }, { apiKey: 'kA' })
  const b = providerFor({ provider: 'apifootball' }, { apiKey: 'kB' })
  expect(b).not.toBe(a)
  expect(providerFor({ provider: 'apifootball' }, { apiKey: 'kA' })).toBe(a)
})

test('sportOf maps provider keys to sports', () => {
  expect(sportOf('apifootball')).toBe('football')
  expect(sportOf('apibasketball')).toBe('basketball')
  expect(() => sportOf('espn')).toThrow(/unknown provider/)
})

test('PROVIDER_KEYS lists every registered provider', () => {
  expect(PROVIDER_KEYS).toEqual(['apifootball', 'apibasketball'])
})

test('seasonInWindow enforces the per-provider plan window, not coverage flags', () => {
  expect(seasonInWindow('apifootball', '2026')).toBe(true)      // Pro key — open
  expect(seasonInWindow('apibasketball', '2023-2024')).toBe(true)
  expect(seasonInWindow('apibasketball', '2021-2022')).toBe(false)
  expect(seasonInWindow('apibasketball', '2025-2026')).toBe(false) // feed advertises it; the plan refuses it
  expect(() => seasonInWindow('espn', '2026')).toThrow(/unknown provider/)
})
