import { expect, test, beforeEach, vi } from 'vitest'
import {
  getAccountToken, setAccountToken, clearAccountToken,
  requestLogin, redeemLogin, passwordLogin, setPassword, getBilling, startCheckout, getCatalog, createSweep,
  revokeSession, revokeAllSessions, rotateSweep, openSweepSession, getAccountSweeps, patchSweep,
} from './accountClient.js'

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  localStorage.clear()
  global.fetch = vi.fn()
})

test('requestLogin POSTs the email with no auth header when signed out', async () => {
  fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
  await requestLogin('a@b.com')
  expect(fetch).toHaveBeenCalledWith('/api/account/login', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ email: 'a@b.com' }),
  }))
  expect(fetch.mock.calls[0][1].headers['x-account-token']).toBeUndefined()
})

test('a stored token rides along as x-account-token on later calls', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(200, { plan: 'active' }))
  await getBilling()
  expect(fetch).toHaveBeenCalledWith('/api/account/billing', expect.objectContaining({
    headers: expect.objectContaining({ 'x-account-token': 't1' }),
  }))
})

test('a non-2xx response throws an Error carrying status + code', async () => {
  fetch.mockResolvedValueOnce(jsonResponse(402, { error: 'subscription_required' }))
  await expect(getBilling()).rejects.toMatchObject({ status: 402, code: 'subscription_required' })
})

test('redeemLogin exchanges the magic-link token and persists the returned accountToken', async () => {
  fetch.mockResolvedValueOnce(jsonResponse(201, {
    accountToken: 'tok2',
    account: { id: 'a1', email: 'x@y.com', name: null },
  }))
  const account = await redeemLogin('tok')
  expect(fetch).toHaveBeenCalledWith('/api/account/session', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ token: 'tok' }),
  }))
  expect(getAccountToken()).toBe('tok2')
  expect(account).toEqual({ id: 'a1', email: 'x@y.com', name: null })
})

test('passwordLogin exchanges email + password for a session and persists the accountToken', async () => {
  fetch.mockResolvedValueOnce(jsonResponse(201, {
    accountToken: 'tok3',
    account: { id: 'a1', email: 'x@y.com', name: null },
  }))
  const account = await passwordLogin('x@y.com', 'hunter22')
  expect(fetch).toHaveBeenCalledWith('/api/account/password/session', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ email: 'x@y.com', password: 'hunter22' }),
  }))
  expect(getAccountToken()).toBe('tok3')
  expect(account).toEqual({ id: 'a1', email: 'x@y.com', name: null })
})

test('setPassword posts only the password when no current one is given (fresh magic-link session)', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(204, null))
  await setPassword('newlongpassword')
  expect(fetch).toHaveBeenCalledWith('/api/account/password', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ password: 'newlongpassword' }),
    headers: expect.objectContaining({ 'x-account-token': 't1' }),
  }))
})

test('setPassword includes current when changing an existing password', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(204, null))
  await setPassword('newlongpassword', 'oldpassword')
  expect(fetch).toHaveBeenCalledWith('/api/account/password', expect.objectContaining({
    body: JSON.stringify({ password: 'newlongpassword', current: 'oldpassword' }),
  }))
})

test('revokeSession DELETEs this device\'s session with the token header', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(204, null))
  await revokeSession()
  expect(fetch).toHaveBeenCalledWith('/api/account/session', expect.objectContaining({
    method: 'DELETE',
    headers: expect.objectContaining({ 'x-account-token': 't1' }),
  }))
})

test('revokeAllSessions DELETEs every session with the token header', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(204, null))
  await revokeAllSessions()
  expect(fetch).toHaveBeenCalledWith('/api/account/sessions', expect.objectContaining({
    method: 'DELETE',
    headers: expect.objectContaining({ 'x-account-token': 't1' }),
  }))
})

test('clearAccountToken removes a stored token', () => {
  setAccountToken('t1')
  clearAccountToken()
  expect(getAccountToken()).toBeNull()
})

test('getCatalog builds a query string from only the non-empty params and attaches the token header', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(200, []))
  await getCatalog({ sport: 'basketball', q: 'nb' })
  expect(fetch).toHaveBeenCalledWith('/api/catalog?sport=basketball&q=nb', expect.objectContaining({
    method: 'GET',
    headers: expect.objectContaining({ 'x-account-token': 't1' }),
  }))
})

test('getCatalog with no params fetches the bare endpoint', async () => {
  fetch.mockResolvedValueOnce(jsonResponse(200, []))
  await getCatalog()
  expect(fetch).toHaveBeenCalledWith('/api/catalog', expect.objectContaining({ method: 'GET' }))
})

test('createSweep POSTs the provision body with the token header', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(201, { id: 'sw1' }))
  const body = { name: 'NBA 2025', provider: 'p', leagueId: 'L2', season: '2025', wageringEnabled: false }
  await createSweep(body)
  expect(fetch).toHaveBeenCalledWith('/api/account/sweeps', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify(body),
    headers: expect.objectContaining({ 'x-account-token': 't1', 'content-type': 'application/json' }),
  }))
})

test('a non-2xx response also carries the parsed body (sweep_cap cap)', async () => {
  fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'sweep_cap', cap: 3 }))
  await expect(createSweep({ name: 'x' })).rejects.toMatchObject({
    status: 403, code: 'sweep_cap', body: { error: 'sweep_cap', cap: 3 },
  })
})

test('startCheckout (bodyless POST) does not include content-type header or body', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(200, { url: 'https://checkout.stripe.com/...' }))
  await startCheckout()
  expect(fetch).toHaveBeenCalledWith('/api/account/billing/checkout', expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ 'x-account-token': 't1' }),
  }))
  const callArgs = fetch.mock.calls[0][1]
  expect(callArgs.headers['content-type']).toBeUndefined()
  expect(callArgs.body).toBeUndefined()
})

test('rotateSweep POSTs the sweep rotate route and returns the fresh member link', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(200, { memberLink: 'https://h/g/new' }))
  await expect(rotateSweep('sw1')).resolves.toEqual({ memberLink: 'https://h/g/new' })
  expect(fetch).toHaveBeenCalledWith('/api/account/sweeps/sw1/rotate', expect.objectContaining({ method: 'POST' }))
})

// The route the gate leans on to get anyone into a sweep on a fresh browser. The whole
// web suite passes with this pointed at a URL that does not exist — it is mocked out
// wherever it is used — so the path itself has to be pinned here.
test('openSweepSession POSTs the account sweep-session route with the token', async () => {
  setAccountToken('t1')
  fetch.mockResolvedValueOnce(jsonResponse(200, { sweepId: 'sw1' }))
  await expect(openSweepSession('sw1')).resolves.toEqual({ sweepId: 'sw1' })
  expect(fetch).toHaveBeenCalledWith('/api/account/sweeps/sw1/session', expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ 'x-account-token': 't1' }),
  }))
})

/* ---- the sweep list is read twice per page load ---------------------------- */
// The console rail lists your sweeps and the page it frames lists them again, and the
// rail renders {children} so it cannot hand the list down. These tests pin the one
// promise both of them share — and, just as important, that a failure is not what gets
// shared forever after.
test('the sweep list is fetched once and shared by everyone who asks for it', async () => {
  fetch.mockResolvedValue(jsonResponse(200, [{ id: 'sw1' }]))
  await getAccountSweeps(true) // drop whatever an earlier test left in the cache
  fetch.mockClear()
  const [a, b] = await Promise.all([getAccountSweeps(), getAccountSweeps()])
  expect(fetch).not.toHaveBeenCalled()
  expect(a).toBe(b)
})

test('fresh=true really refetches — this is what every mutation has to pass', async () => {
  fetch.mockResolvedValue(jsonResponse(200, []))
  await getAccountSweeps(true)
  fetch.mockClear()
  await getAccountSweeps(true)
  expect(fetch).toHaveBeenCalledTimes(1)
})

// A cached rejection would be permanent: the console's own retry would hand back the
// same failure without ever touching the network again.
test('a failed list is evicted, so the next caller genuinely retries', async () => {
  fetch.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
  await expect(getAccountSweeps(true)).rejects.toMatchObject({ status: 500 })
  fetch.mockResolvedValueOnce(jsonResponse(200, [{ id: 'sw1' }]))
  await expect(getAccountSweeps()).resolves.toEqual([{ id: 'sw1' }])
})

// The owner's own sweep. This endpoint has existed since it was written with no client
// wrapper and no UI behind it, so renaming your own sweep was an operator-only power.
test('patchSweep PATCHes the owner sweep route with the token header', async () => {
  setAccountToken('t9')
  fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
  await patchSweep('sw1', { name: 'The Lads' })
  expect(fetch).toHaveBeenCalledWith('/api/account/sweeps/sw1', expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ name: 'The Lads' }),
    headers: expect.objectContaining({ 'x-account-token': 't9' }),
  }))
})
