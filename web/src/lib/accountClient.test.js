import { expect, test, beforeEach, vi } from 'vitest'
import {
  getAccountToken, setAccountToken, clearAccountToken,
  requestLogin, redeemLogin, getBilling, startCheckout, getCatalog, createSweep,
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
