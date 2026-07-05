import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The account shell is header-token auth, separate from the sweep session —
// mock accountClient so these tests never touch fetch.
vi.mock('./lib/accountClient.js', () => ({
  getBilling: vi.fn(),
  getAccountSweeps: vi.fn(),
  archiveSweep: vi.fn(async () => ({})),
  startCheckout: vi.fn(),
  openPortal: vi.fn(),
  clearAccountToken: vi.fn(),
}))

import { AccountHome } from './screens-account.jsx'
import {
  getBilling, getAccountSweeps, archiveSweep, startCheckout, openPortal, clearAccountToken,
} from './lib/accountClient.js'

let originalLocation

beforeEach(() => {
  vi.clearAllMocks()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: null, liveSweeps: 0, quantity: 0 })
  getAccountSweeps.mockResolvedValue([])
  originalLocation = window.location
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, assign: vi.fn(), reload: vi.fn() },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true })
})

test('fresh account: explains the trial', async () => {
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: null, liveSweeps: 0, quantity: 0 })
  getAccountSweeps.mockResolvedValue([])
  render(<AccountHome />)
  expect(await screen.findByText(/14-day free trial starts with your first sweep/i)).toBeTruthy()
})

test('trialing: countdown + subscribe CTA calls checkout and redirects', async () => {
  const future = new Date(Date.now() + 3 * 86400000).toISOString()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: future, liveSweeps: 0, quantity: 0 })
  startCheckout.mockResolvedValue({ url: 'https://stripe.example/checkout/1' })
  render(<AccountHome />)
  expect(await screen.findByText(/day.*left in your.*trial/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))
  await waitFor(() => expect(startCheckout).toHaveBeenCalled())
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://stripe.example/checkout/1'))
})

test('subscribed: shows live sweep count and Manage billing (portal)', async () => {
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'active', trialEndsAt: null, liveSweeps: 2, quantity: 2 })
  openPortal.mockResolvedValue({ url: 'https://stripe.example/portal/1' })
  render(<AccountHome />)
  expect(await screen.findByText(/2 live sweeps/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /manage billing/i }))
  await waitFor(() => expect(openPortal).toHaveBeenCalled())
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://stripe.example/portal/1'))
})

test('lapsed: subscribe CTA + read-only warning', async () => {
  const past = new Date(Date.now() - 86400000).toISOString()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: past, liveSweeps: 1, quantity: 0 })
  render(<AccountHome />)
  expect(await screen.findByText(/read-only/i)).toBeTruthy()
  expect(screen.getByRole('button', { name: /subscribe/i })).toBeTruthy()
})

test('sweep list renders links and archives with two-tap confirm', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', competitionId: 'c1', archivedAt: null, createdAt: 'x', memberLink: 'https://h/g/m1', adminLink: 'https://h/admin/a1' }])
  render(<AccountHome />)
  expect(await screen.findByText('My NBA')).toBeTruthy()
  expect(screen.getByDisplayValue('https://h/g/m1')).toBeTruthy()
  expect(screen.getByDisplayValue('https://h/admin/a1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^archive$/i }))
  const confirmBtn = await screen.findByRole('button', { name: /really archive\?/i })
  fireEvent.click(confirmBtn)
  await waitFor(() => expect(archiveSweep).toHaveBeenCalledWith('sw1'))
})

test('archive failure shows an inline error and resets the confirm state', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', competitionId: 'c1', archivedAt: null, createdAt: 'x', memberLink: 'https://h/g/m1', adminLink: 'https://h/admin/a1' }])
  archiveSweep.mockRejectedValue(new Error('boom'))
  render(<AccountHome />)
  expect(await screen.findByText('My NBA')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^archive$/i }))
  fireEvent.click(await screen.findByRole('button', { name: /really archive\?/i }))
  expect(await screen.findByText(/archive failed/i)).toBeTruthy()
  expect(screen.getByRole('button', { name: /^archive$/i })).toBeTruthy() // confirm state reset
})

test('account load failure shows an inline error instead of a silent empty list', async () => {
  getBilling.mockRejectedValue(new Error('boom'))
  getAccountSweeps.mockRejectedValue(new Error('boom'))
  render(<AccountHome />)
  expect(await screen.findByText(/something went wrong/i)).toBeTruthy()
})

test('archived sweeps are filtered out', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'Old One', competitionId: 'c1', archivedAt: '2026-01-01T00:00:00Z', createdAt: 'x', memberLink: 'https://h/g/m1', adminLink: 'https://h/admin/a1' }])
  render(<AccountHome />)
  await waitFor(() => expect(getAccountSweeps).toHaveBeenCalled())
  expect(screen.queryByText('Old One')).toBeNull()
})

test('subscribe: a 409 already_subscribed falls back to the portal', async () => {
  const future = new Date(Date.now() + 86400000).toISOString()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: future, liveSweeps: 0, quantity: 0 })
  startCheckout.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, code: 'already_subscribed' }))
  openPortal.mockResolvedValue({ url: 'https://stripe.example/portal/2' })
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /subscribe/i }))
  await waitFor(() => expect(openPortal).toHaveBeenCalled())
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://stripe.example/portal/2'))
})

test('manage billing: a 409 not_subscribed falls back to checkout', async () => {
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'active', trialEndsAt: null, liveSweeps: 1, quantity: 1 })
  openPortal.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, code: 'not_subscribed' }))
  startCheckout.mockResolvedValue({ url: 'https://stripe.example/checkout/2' })
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /manage billing/i }))
  await waitFor(() => expect(startCheckout).toHaveBeenCalled())
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://stripe.example/checkout/2'))
})

test('subscribed + past_due shows a soft payment warning', async () => {
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'past_due', trialEndsAt: null, liveSweeps: 1, quantity: 1 })
  render(<AccountHome />)
  expect(await screen.findByText(/payment failed|past due/i)).toBeTruthy()
})

test('sign out clears the account token and reloads', async () => {
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
  expect(clearAccountToken).toHaveBeenCalled()
  expect(window.location.reload).toHaveBeenCalled()
})
