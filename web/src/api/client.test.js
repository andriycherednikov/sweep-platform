import { expect, test, vi, beforeEach } from 'vitest'
import { fetchBootstrap, fetchFixtures, fetchStandings, fetchPhotos, fetchSyncStatus, fetchAll } from './client.js'

beforeEach(() => { vi.restoreAllMocks() })

function mockJson(map) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (path in map) return { ok: true, status: 200, json: async () => map[path] }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
}

test('fetchBootstrap hits /api/bootstrap and returns json', async () => {
  mockJson({ '/api/bootstrap': { teams: [], people: [], ownership: {}, scoring: null } })
  const b = await fetchBootstrap()
  expect(b).toEqual({ teams: [], people: [], ownership: {}, scoring: null })
})

test('a non-ok response throws', async () => {
  mockJson({})
  await expect(fetchStandings()).rejects.toThrow(/standings/i)
})

test('fetchAll resolves the whole bundle in parallel', async () => {
  mockJson({
    '/api/bootstrap': { teams: [{ code: 'hr' }], people: [], ownership: {}, scoring: { rule: 'top3' } },
    '/api/fixtures': [{ id: '1' }],
    '/api/standings': { A: [] },
    '/api/photos': [],
    '/api/sync-status': { stale: false, lastBaselineAt: null, lastLiveAt: null },
  })
  const all = await fetchAll()
  expect(all.bootstrap.teams).toHaveLength(1)
  expect(all.fixtures).toHaveLength(1)
  expect(all.syncStatus.stale).toBe(false)
})
