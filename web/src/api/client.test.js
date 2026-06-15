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

test('uploadPhoto POSTs FormData to /api/photos', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, json: async () => ({ id: 'x', status: 'pending' }) } }))
  const { uploadPhoto } = await import('./client.js')
  const fd = new FormData()
  const res = await uploadPhoto(fd)
  expect(res.id).toBe('x') // returns the parsed created-photo body
  expect(calls[0].url).toMatch(/\/api\/photos$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.body).toBe(fd) // raw FormData, no JSON content-type
})

test('adminLogin posts the passcode and includes credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ admin: true }) } }))
  const { adminLogin } = await import('./client.js')
  await adminLogin('1234')
  expect(calls[0].url).toMatch(/\/api\/admin\/login$/)
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ passcode: '1234' })
})

test('fetchAdminPhotos GETs the queue with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ pending: [], approved: [] }) } }))
  const { fetchAdminPhotos } = await import('./client.js')
  await fetchAdminPhotos()
  expect(calls[0].opts.credentials).toBe('include')
})

test('adminLogin throws on 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
  const { adminLogin } = await import('./client.js')
  await expect(adminLogin('nope')).rejects.toThrow(/login/i)
})

test('public get sends credentials:include (cookie scopes platform-host reads)', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ teams: [] }) }
  }))
  const { fetchBootstrap } = await import('./client.js')
  await fetchBootstrap()
  expect(calls[0].url).toMatch(/\/api\/bootstrap$/)
  expect(calls[0].opts?.credentials).toBe('include')
})

test('public post sends credentials:include', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ watching: true }) }
  }))
  const { postWatch } = await import('./client.js')
  await postWatch('m1', 'p1')
  expect(calls[0].opts.credentials).toBe('include')
})

test('uploadPhoto sends credentials:include with raw FormData', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 201, json: async () => ({ id: 'x', status: 'pending' }) }
  }))
  const { uploadPhoto } = await import('./client.js')
  const fd = new FormData()
  await uploadPhoto(fd)
  expect(calls[0].opts.credentials).toBe('include')
  expect(calls[0].opts.body).toBe(fd)
})

test('postSession POSTs the token with credentials and returns {sweepId, role}', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ sweepId: 'sw_a', role: 'member' }) }
  }))
  const { postSession } = await import('./client.js')
  const res = await postSession('tok123')
  expect(res).toEqual({ sweepId: 'sw_a', role: 'member' })
  expect(calls[0].url).toMatch(/\/api\/session$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ token: 'tok123' })
})

test('fetchWhoami GETs /api/whoami with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ sweepId: null, role: null }) }
  }))
  const { fetchWhoami } = await import('./client.js')
  const res = await fetchWhoami()
  expect(res).toEqual({ sweepId: null, role: null })
  expect(calls[0].url).toMatch(/\/api\/whoami$/)
  expect(calls[0].opts.credentials).toBe('include')
})

test('postLogout POSTs /api/session/logout with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }))
  const { postLogout } = await import('./client.js')
  await postLogout()
  expect(calls[0].url).toMatch(/\/api\/session\/logout$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({})
})
