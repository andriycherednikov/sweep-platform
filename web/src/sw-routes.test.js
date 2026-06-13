import { describe, expect, test } from 'vitest'
import { SW_ROUTES } from './sw-routes.js'

const byId = (id) => SW_ROUTES.find((r) => r.id === id)

describe('service-worker runtime caching contract', () => {
  test('/api is NetworkFirst so online data is never stale', () => {
    const r = byId('api')
    expect(r.strategy).toBe('NetworkFirst')
    expect(r.pathPrefix).toBe('/api')
  })

  test('/photos is CacheFirst (approved photos are immutable) with expiration', () => {
    const r = byId('photos')
    expect(r.strategy).toBe('CacheFirst')
    expect(r.pathPrefix).toBe('/photos')
    expect(r.maxEntries).toBeGreaterThan(0)
    expect(r.maxAgeSeconds).toBeGreaterThan(0)
  })

  test('google fonts are CacheFirst, matched by origin, with expiration', () => {
    const r = byId('fonts')
    expect(r.strategy).toBe('CacheFirst')
    expect(r.origins).toContain('https://fonts.googleapis.com')
    expect(r.origins).toContain('https://fonts.gstatic.com')
    expect(r.maxAgeSeconds).toBeGreaterThan(0)
  })

  test('every route names a distinct cache', () => {
    const names = SW_ROUTES.map((r) => r.cacheName)
    expect(new Set(names).size).toBe(names.length)
  })
})
