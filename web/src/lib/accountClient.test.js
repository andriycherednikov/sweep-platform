import { expect, test, beforeEach, vi } from 'vitest'
import {
  getAccountToken, setAccountToken, clearAccountToken,
  requestLogin, redeemLogin, getBilling,
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
