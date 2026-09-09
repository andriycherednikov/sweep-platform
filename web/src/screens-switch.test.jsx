// web/src/screens-switch.test.jsx — /switch is account territory now.
//
// Membership is an account, not a browser: the list of sweeps you are in belongs to
// whoever is signed in, so a signed-out visitor gets the sign-in page, not a list of
// somebody's sweeps left behind in this browser's localStorage.
import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

vi.mock('./lib/accountClient.js', () => ({
  getAccountToken: vi.fn(() => null),
  clearAccountToken: vi.fn(),
  getAccount: vi.fn(async () => ({ id: 'ac_1', email: 'a@b.test' })),
}))
import { SweepSwitcher } from './screens-switch.jsx'
import { getAccountToken, clearAccountToken, getAccount } from './lib/accountClient.js'

let originalLocation, assign
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  getAccountToken.mockReturnValue(null)
  getAccount.mockResolvedValue({ id: 'ac_1', email: 'a@b.test' })
  originalLocation = window.location
  assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { ...originalLocation, assign }, configurable: true, writable: true })
  localStorage.setItem('sweep.sweeps.v1', JSON.stringify([{ sweepId: 'sw_1', name: 'NBA renewed', token: 't1' }]))
})
afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true })
})

test('a signed-out visitor is sent to sign in and never sees the sweeps in this browser', async () => {
  const { container } = render(<SweepSwitcher />)
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/account'))
  expect(container.textContent).not.toContain('NBA renewed')
})

// A token in localStorage is not proof: it is revoked server-side by signing out
// anywhere, and this page used to believe it forever.
test('a stale token is thrown away and still lands on sign in', async () => {
  getAccountToken.mockReturnValue('tok_dead')
  getAccount.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }))
  const { container } = render(<SweepSwitcher />)
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/account'))
  expect(clearAccountToken).toHaveBeenCalled()
  expect(container.textContent).not.toContain('NBA renewed')
})

test('a signed-in visitor gets their sweeps, and nobody is redirected', async () => {
  getAccountToken.mockReturnValue('tok_live')
  const { findByText } = render(<SweepSwitcher />)
  expect(await findByText('NBA renewed')).toBeInTheDocument()
  expect(assign).not.toHaveBeenCalled()
})
