import { expect, test, vi, beforeEach } from 'vitest'
import { fetchBootstrap, fetchFixtures, fetchStandings, fetchPhotos, fetchSyncStatus, fetchAll, fetchWallet, postBet } from './client.js'

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

test('patchCreds and patchPerson PATCH JSON with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ id: 'p1', name: 'Bo' }) }
  }))
  const { patchPerson } = await import('./client.js')
  const res = await patchPerson('p1', { name: 'Bo' })
  expect(res).toEqual({ id: 'p1', name: 'Bo' })
  expect(calls[0].url).toMatch(/\/api\/admin\/people\/p1$/)
  expect(calls[0].opts.method).toBe('PATCH')
  expect(calls[0].opts.credentials).toBe('include')
  expect(calls[0].opts.headers['Content-Type']).toBe('application/json')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'Bo' })
})

test('createPerson POSTs the new person fields with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, json: async () => ({ id: 'p9' }) } }))
  const { createPerson } = await import('./client.js')
  await createPerson({ name: 'New', short: 'New', initials: 'NW', av: null })
  expect(calls[0].url).toMatch(/\/api\/admin\/people$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'New', short: 'New', initials: 'NW', av: null })
})

test('deletePerson DELETEs /api/admin/people/:id with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) } }))
  const { deletePerson } = await import('./client.js')
  await deletePerson('p1')
  expect(calls[0].url).toMatch(/\/api\/admin\/people\/p1$/)
  expect(calls[0].opts.method).toBe('DELETE')
  expect(calls[0].opts.credentials).toBe('include')
})

test('postOwnership and deleteOwnership send personId+teamCode with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) } }))
  const { postOwnership, deleteOwnership } = await import('./client.js')
  await postOwnership('p1', 'hr')
  expect(calls[0].url).toMatch(/\/api\/admin\/ownership$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ personId: 'p1', teamCode: 'hr' })
  await deleteOwnership('p1', 'hr')
  expect(calls[1].opts.method).toBe('DELETE')
  expect(calls[1].opts.credentials).toBe('include')
  expect(JSON.parse(calls[1].opts.body)).toEqual({ personId: 'p1', teamCode: 'hr' })
})

test('bulkPostOwnership and bulkDeleteOwnership send items to the bulk route', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) } }))
  const { bulkPostOwnership, bulkDeleteOwnership } = await import('./client.js')
  const items = [{ personId: 'p1', teamCode: 'hr' }, { personId: 'p1', teamCode: 'br' }]
  await bulkPostOwnership(items)
  expect(calls[0].url).toMatch(/\/api\/admin\/ownership\/bulk$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ items })
  await bulkDeleteOwnership(items)
  expect(calls[1].url).toMatch(/\/api\/admin\/ownership\/bulk$/)
  expect(calls[1].opts.method).toBe('DELETE')
  expect(JSON.parse(calls[1].opts.body)).toEqual({ items })
})

test('postSuperSession POSTs the token to /api/super/session with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ super: true }) } }))
  const { postSuperSession } = await import('./client.js')
  const res = await postSuperSession('sup3rt0ken')
  expect(res).toEqual({ super: true })
  expect(calls[0].url).toMatch(/\/api\/super\/session$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ token: 'sup3rt0ken' })
})

test('fetchSuperSweeps GETs /api/super/sweeps with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ([{ id: 'sw_a', name: 'A' }]) } }))
  const { fetchSuperSweeps } = await import('./client.js')
  const list = await fetchSuperSweeps()
  expect(list).toHaveLength(1)
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps$/)
  expect(calls[0].opts.credentials).toBe('include')
})

test('createSweep POSTs the name and returns the link bundle', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, json: async () => ({ id: 'sw_b', name: 'Office', memberLink: '/g/m', adminLink: '/g/m/admin/a' }) } }))
  const { createSweep } = await import('./client.js')
  const res = await createSweep('Office')
  expect(res.memberLink).toBe('/g/m')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'Office' })
})

test('rotateSweepToken POSTs which to the rotate route', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ memberLink: '/g/new' }) } }))
  const { rotateSweepToken } = await import('./client.js')
  await rotateSweepToken('sw_a', 'member')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps\/sw_a\/rotate$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ which: 'member' })
})

test('archiveSweep and unarchiveSweep hit their routes with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}) } }))
  const { archiveSweep, unarchiveSweep } = await import('./client.js')
  await archiveSweep('sw_a')
  await unarchiveSweep('sw_a')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps\/sw_a\/archive$/)
  expect(calls[0].opts.credentials).toBe('include')
  expect(calls[1].url).toMatch(/\/api\/super\/sweeps\/sw_a\/unarchive$/)
  expect(calls[1].opts.credentials).toBe('include')
})

test('patchSweep PATCHes the fields with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ id: 'sw_a', name: 'Renamed' }) } }))
  const { patchSweep } = await import('./client.js')
  const res = await patchSweep('sw_a', { name: 'Renamed' })
  expect(res.name).toBe('Renamed')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps\/sw_a$/)
  expect(calls[0].opts.method).toBe('PATCH')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'Renamed' })
})

test('fetchWallet GETs /api/coins with personId query and credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ balance: 1000, leaderboard: [] }) }
  }))
  const res = await fetchWallet('pn_x')
  expect(res).toEqual({ balance: 1000, leaderboard: [] })
  expect(calls[0].url).toMatch(/\/api\/coins\?personId=pn_x$/)
  expect(calls[0].opts.credentials).toBe('include')
})

test('postBet POSTs the bet body to /api/bet with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }))
  await postBet({ fixtureId: 'f1', personId: 'pn_x', selection: 'HOME', stake: 100 })
  expect(calls[0].url).toMatch(/\/api\/bet$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ fixtureId: 'f1', personId: 'pn_x', selection: 'HOME', stake: 100 })
})
