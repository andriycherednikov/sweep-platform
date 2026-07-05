import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// AccountRoot is the SaaS front door: header-token auth, separate from the
// sweep session cookie — mock the client so these tests never touch fetch.
vi.mock('./lib/accountClient.js', () => ({
  requestLogin: vi.fn(async () => ({ ok: true })),
  redeemLogin: vi.fn(async () => ({ id: 'a1', email: 'x@y.com', name: null })),
  getAccount: vi.fn(async () => ({ id: 'a1', email: 'x@y.com', name: null })),
  getAccountToken: vi.fn(() => null),
  clearAccountToken: vi.fn(),
  // AccountHome (the signed-in view) loads these on mount — stub with an
  // empty/fresh account so the "in" state renders without crashing.
  getBilling: vi.fn(async () => ({ subscribed: false, subscriptionStatus: null, trialEndsAt: null, liveSweeps: 0, quantity: 0 })),
  getAccountSweeps: vi.fn(async () => ([])),
  archiveSweep: vi.fn(async () => ({})),
  startCheckout: vi.fn(),
  openPortal: vi.fn(),
}))

import { AccountRoot } from './AccountRoot.jsx'
import * as accountClient from './lib/accountClient.js'

let originalLocation

beforeEach(() => {
  vi.clearAllMocks()
  accountClient.getAccountToken.mockReturnValue(null)
  originalLocation = window.location
})

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true })
})

test('unauthenticated /account renders the sign-in email form (no stale getAccount check)', () => {
  window.history.replaceState(null, '', '/account')
  render(<AccountRoot />)
  expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument()
  expect(accountClient.getAccount).not.toHaveBeenCalled()
})

test('a stored token is verified via getAccount(); a stale (401) token is cleared and the form shows', async () => {
  accountClient.getAccountToken.mockReturnValue('stale-tok')
  accountClient.getAccount.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
  window.history.replaceState(null, '', '/account')
  render(<AccountRoot />)
  await waitFor(() => expect(accountClient.clearAccountToken).toHaveBeenCalled())
  expect(await screen.findByPlaceholderText(/email/i)).toBeInTheDocument()
})

test('a valid stored token lands straight on the account home (billing + sweeps load)', async () => {
  accountClient.getAccountToken.mockReturnValue('good-tok')
  window.history.replaceState(null, '', '/account')
  render(<AccountRoot />)
  expect(await screen.findByText(/14-day free trial starts with your first sweep/i)).toBeInTheDocument()
})

test('submitting the email form calls requestLogin and shows the check-your-email message', async () => {
  window.history.replaceState(null, '', '/account')
  render(<AccountRoot />)
  fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'me@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /send/i }))
  await waitFor(() => expect(accountClient.requestLogin).toHaveBeenCalledWith('me@example.com'))
  expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  expect(screen.getByText(/dev: the link is printed on the api console/i)).toBeInTheDocument()
})

test('/account/login/:token redeems the token then navigates to the account home', async () => {
  window.history.replaceState(null, '', '/account/login/abc')
  const replace = vi.fn()
  Object.defineProperty(window, 'location', { value: { ...window.location, replace }, configurable: true, writable: true })
  render(<AccountRoot />)
  await waitFor(() => expect(accountClient.redeemLogin).toHaveBeenCalledWith('abc'))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/account'))
})

test('a 401 (used/expired) redeem shows the link-expired message with a way back', async () => {
  accountClient.redeemLogin.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
  window.history.replaceState(null, '', '/account/login/badtoken')
  render(<AccountRoot />)
  expect(await screen.findByText(/link expired/i)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /back to my account/i })).toHaveAttribute('href', '/account')
})

test('the billing success landing renders its message', () => {
  window.history.replaceState(null, '', '/account/billing/success')
  render(<AccountRoot />)
  expect(screen.getByText(/subscription active/i)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /back to my account/i })).toBeInTheDocument()
})

test('the billing cancelled landing renders its message', () => {
  window.history.replaceState(null, '', '/account/billing/cancelled')
  render(<AccountRoot />)
  expect(screen.getByText(/checkout cancelled/i)).toBeInTheDocument()
})
