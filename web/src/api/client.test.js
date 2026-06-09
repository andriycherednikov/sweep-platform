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

test('fetchSocial hits /api/social', async () => {
  mockJson({ '/api/social': { watch: { m1: ['p1'] }, support: {} } })
  const { fetchSocial } = await import('./client.js')
  expect(await fetchSocial()).toEqual({ watch: { m1: ['p1'] }, support: {} })
})

test('postWatch POSTs fixtureId+personId and returns the new state', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ fixtureId: 'm1', personId: 'p1', watching: true }) }
  }))
  const { postWatch } = await import('./client.js')
  const res = await postWatch('m1', 'p1')
  expect(res.watching).toBe(true)
  expect(calls[0].url).toMatch(/\/api\/watch$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ fixtureId: 'm1', personId: 'p1' })
})

test('postSupport POSTs fixtureId+personId+teamCode', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ supporting: 'hr' }) }
  }))
  const { postSupport } = await import('./client.js')
  await postSupport('m1', 'p1', 'hr')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ fixtureId: 'm1', personId: 'p1', teamCode: 'hr' })
})

test('a non-ok POST throws', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })))
  const { postWatch } = await import('./client.js')
  await expect(postWatch('m1', 'p1')).rejects.toThrow(/watch/i)
})
