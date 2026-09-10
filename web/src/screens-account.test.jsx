import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The account shell is header-token auth, separate from the sweep session —
// mock accountClient so these tests never touch fetch.
vi.mock('./lib/accountClient.js', () => ({
  getAccount: vi.fn(async () => ({ id: 'ac_1', email: 'you@x.test', name: 'Ada Lovelace' })),
  getBilling: vi.fn(),
  getAccountSweeps: vi.fn(),
  patchAccount: vi.fn(),
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  archiveSweep: vi.fn(async () => ({})),
  rotateSweep: vi.fn(async () => ({ memberLink: 'https://h/g/new' })),
  startCheckout: vi.fn(),
  openPortal: vi.fn(),
  clearAccountToken: vi.fn(),
  revokeSession: vi.fn(async () => ({})),
  revokeAllSessions: vi.fn(async () => ({})),
}))

import { AccountHome, AccountSettings } from './screens-account.jsx'
import {
  getAccount, getBilling, getAccountSweeps, archiveSweep, rotateSweep, startCheckout, openPortal, clearAccountToken,
  patchAccount, requestEmailChange,
  revokeSession, revokeAllSessions,
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

test('sweep list renders its member link and archives with two-tap confirm', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', competitionId: 'c1', archivedAt: null, createdAt: 'x', memberLink: 'https://h/g/m1' }])
  render(<AccountHome />)
  expect(await screen.findByText('My NBA')).toBeTruthy()
  expect(screen.getByDisplayValue('https://h/g/m1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^archive$/i }))
  const confirmBtn = await screen.findByRole('button', { name: /really archive\?/i })
  fireEvent.click(confirmBtn)
  await waitFor(() => expect(archiveSweep).toHaveBeenCalledWith('sw1'))
})

test('archive failure shows an inline error and resets the confirm state', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', competitionId: 'c1', archivedAt: null, createdAt: 'x', memberLink: 'https://h/g/m1' }])
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
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'Old One', competitionId: 'c1', archivedAt: '2026-01-01T00:00:00Z', createdAt: 'x', memberLink: 'https://h/g/m1' }])
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

test('sign out (this device) revokes the session, clears the token and reloads', async () => {
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^settings$/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /^log out$/i }))
  await waitFor(() => expect(revokeSession).toHaveBeenCalled())
  expect(revokeAllSessions).not.toHaveBeenCalled()
  expect(clearAccountToken).toHaveBeenCalled()
  expect(window.location.reload).toHaveBeenCalled()
})

test('sign out everywhere revokes every session, clears the token and reloads', async () => {
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^settings$/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /log out everywhere/i }))
  await waitFor(() => expect(revokeAllSessions).toHaveBeenCalled())
  expect(revokeSession).not.toHaveBeenCalled()
  expect(clearAccountToken).toHaveBeenCalled()
  expect(window.location.reload).toHaveBeenCalled()
})

test('sign out still clears locally and reloads even when the server revoke fails', async () => {
  revokeSession.mockRejectedValueOnce(new Error('network'))
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^settings$/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /^log out$/i }))
  await waitFor(() => expect(clearAccountToken).toHaveBeenCalled())
  expect(window.location.reload).toHaveBeenCalled()
})

// Unlike this-device sign-out, a failed revoke-everywhere must not look identical to a
// successful one: other sessions are still live, and this credential grants admin over
// every sweep the account owns. Still clears + leaves (staying signed in is worse), but
// distinguishably — a flag Entry can show, surviving the reload.
test('a failed sign-out-everywhere still clears locally, but surfaces the failure instead of reloading silently', async () => {
  revokeAllSessions.mockRejectedValueOnce(new Error('network'))
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^settings$/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /log out everywhere/i }))
  await waitFor(() => expect(clearAccountToken).toHaveBeenCalled())
  expect(window.location.assign).toHaveBeenCalledWith('/account?signout=partial')
  expect(window.location.reload).not.toHaveBeenCalled()
})

test('empty sweep list links to the catalog (Set up your first sweep)', async () => {
  render(<AccountHome />)
  await screen.findByText(/no sweeps yet/i)
  fireEvent.click(screen.getByRole('button', { name: /set up your first sweep/i }))
  expect(window.location.assign).toHaveBeenCalledWith('/account/new')
})

test('a non-empty sweep list shows a New sweep button to the catalog', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw1', name: 'My NBA', archivedAt: null, memberLink: 'https://h/g/m1' },
  ])
  render(<AccountHome />)
  await screen.findByText('My NBA')
  fireEvent.click(screen.getByRole('button', { name: /new sweep/i }))
  expect(window.location.assign).toHaveBeenCalledWith('/account/new')
})

// A member link pasted into the wrong chat is permanent otherwise: it is the only
// credential POST /api/session accepts, and archiving (killing the sweep for everyone)
// was the owner's only remedy.
test('a leaked member link can be replaced, after a warning that it locks everyone out', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', archivedAt: null, memberLink: 'https://h/g/old' }])
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^replace link$/i }))
  expect(rotateSweep).not.toHaveBeenCalled() // one tap warns, it does not rotate
  expect(screen.getByText(/locked out/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /yes, replace the link/i }))
  await waitFor(() => expect(rotateSweep).toHaveBeenCalledWith('sw1'))
  // the owner needs the new link in hand — it is what they send the group next
  expect(await screen.findByDisplayValue('https://h/g/new')).toBeTruthy()
})

// Revoking a leaked link is damage control, not a paid feature — and a lapsed owner
// is exactly who needs it (api/src/routes/account.js rotates with requireLive:false).
test('a lapsed owner can still replace the link', async () => {
  const past = new Date(Date.now() - 86400000).toISOString()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: past, liveSweeps: 1, quantity: 0 })
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', archivedAt: null, memberLink: 'https://h/g/old' }])
  render(<AccountHome />)
  const btn = await screen.findByRole('button', { name: /^replace link$/i })
  expect(btn.disabled).toBe(false)
})

test('a failed rotate says so and leaves the old link showing', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', archivedAt: null, memberLink: 'https://h/g/old' }])
  rotateSweep.mockRejectedValueOnce(new Error('boom'))
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^replace link$/i }))
  fireEvent.click(screen.getByRole('button', { name: /yes, replace the link/i }))
  expect(await screen.findByText(/couldn't replace the link/i)).toBeTruthy()
  expect(screen.getByDisplayValue('https://h/g/old')).toBeTruthy()
})

test('a sweep card reports who has joined and links to managing them', async () => {
  getAccountSweeps.mockResolvedValue([{
    id: 'sw_1', name: 'Office', competitionId: 'c', archivedAt: null, createdAt: null,
    memberLink: 'https://x.test/g/tok', members: { total: 12, registered: 8 },
  }])
  render(<AccountHome />)
  expect(await screen.findByText(/12 in the sweep/)).toBeInTheDocument()
  expect(screen.getByText(/4 not joined yet/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /manage members/i })).toHaveAttribute('href', '/s/sw_1/admin')
})

test('a fully-joined sweep says so without a nag', async () => {
  getAccountSweeps.mockResolvedValue([{
    id: 'sw_1', name: 'Office', competitionId: 'c', archivedAt: null, createdAt: null,
    memberLink: 'https://x.test/g/tok', members: { total: 5, registered: 5 },
  }])
  render(<AccountHome />)
  expect(await screen.findByText(/5 in the sweep/)).toBeInTheDocument()
  expect(screen.queryByText(/not joined yet/)).toBeNull()
})

// Most people never run a sweep — they are only ever in somebody else's, and the
// console could not see those at all.
test('sweeps you are in are listed, separately from the ones you run', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw1', name: 'My NBA', competitionId: 'c1', archivedAt: null, createdAt: 'x', role: 'owner', memberLink: 'https://h/g/m1', members: { total: 3, registered: 2 } },
    { id: 'sw2', name: 'Office Footy', competitionId: 'c2', archivedAt: null, createdAt: 'x', role: 'member' },
  ])
  render(<AccountHome />)
  expect(await screen.findByText('My NBA')).toBeTruthy()
  expect(screen.getByText('Office Footy')).toBeTruthy()
  expect(screen.getByText(/sweeps you run/i)).toBeTruthy()
  expect(screen.getByText(/sweeps you're in/i)).toBeTruthy()
  expect(screen.getByRole('link', { name: /office footy/i })).toHaveAttribute('href', '/s/sw2')
})

// A member has no billing, no link to hand out and nothing to archive — those belong
// to whoever runs it.
test('a sweep you only play in carries none of the owner controls', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw2', name: 'Office Footy', competitionId: 'c2', archivedAt: null, createdAt: 'x', role: 'member' },
  ])
  render(<AccountHome />)
  expect(await screen.findByText('Office Footy')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^archive$/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /replace link/i })).toBeNull()
  // and it still nudges them to run one of their own
  expect(screen.getByText(/don't run one yet/i)).toBeTruthy()
})

test('the rail says who you are signed in as', async () => {
  render(<AccountHome />)
  expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
  expect(screen.getByText(/signed in as/i)).toBeTruthy()
})

// A sweep's name is whatever the owner typed. "Office Pool" says nothing about what it
// follows, so the competition is what makes a list of several sweeps readable.
test('every sweep names the competition it follows', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw1', name: 'Office Pool', role: 'owner', archivedAt: null, memberLink: 'https://h/g/m1',
      competition: { name: 'NBA 2025-26', sport: 'basketball', logo: null } },
    { id: 'sw2', name: 'The Lads', role: 'member', archivedAt: null,
      competition: { name: 'Premier League 2025-26', sport: 'football', logo: null } },
  ])
  render(<AccountHome />)
  expect(await screen.findByText('NBA 2025-26')).toBeTruthy()
  expect(screen.getByText('Premier League 2025-26')).toBeTruthy()
  expect(screen.getByText('basketball')).toBeTruthy()
})

// Somebody who already plays in a sweep came here to find it, not to be told what they
// have not done — the invitation to run one used to sit above their own sweeps.
test('the sweeps you are in come before the invitation to run one', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw2', name: 'The Lads', role: 'member', archivedAt: null, competition: null },
  ])
  const { container } = render(<AccountHome />)
  await screen.findByText('The Lads')
  const text = container.textContent
  expect(text.indexOf('The Lads')).toBeLessThan(text.indexOf("You don't run one yet"))
})

// One thing to do with a sweep you only play in, so the whole row is the target —
// a real <a> so cmd-click and the keyboard keep working.
test('a sweep you are in is clickable across the whole row', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw2', name: 'The Lads', role: 'member', archivedAt: null, competition: null },
  ])
  render(<AccountHome />)
  const row = (await screen.findByText('The Lads')).closest('a')
  expect(row).toBeTruthy()
  expect(row.getAttribute('href')).toBe('/s/sw2')
  expect(row.classList.contains('ac-card')).toBe(true) // the card itself, not a child link
})

// A sweep you're in is one big link; a sweep you run is full of controls, so the name
// and a chevron carry the same job. Either way the card gets you into the sweep.
test('a sweep you run can be opened from its card', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw1', name: 'Office Pool', role: 'owner', archivedAt: null, memberLink: 'https://h/g/m1',
      competition: { name: 'Premier League 2026', sport: 'football', season: '2026', logo: null } },
  ])
  render(<AccountHome />)
  const name = (await screen.findByText('Office Pool')).closest('a')
  expect(name.getAttribute('href')).toBe('/s/sw1')
  expect(screen.getByLabelText('Open Office Pool').getAttribute('href')).toBe('/s/sw1')
})

/* ---- account settings ---------------------------------------------------- */
// The name is not a credential, so it just changes.
test('the name can be edited and saved', async () => {
  getAccount.mockResolvedValue({ id: 'ac1', email: 'me@x.test', name: 'Old', hasPassword: false })
  patchAccount.mockResolvedValue({ id: 'ac1', email: 'me@x.test', name: 'New' })
  render(<AccountSettings />)
  const field = await screen.findByLabelText('Name')
  expect(screen.getByRole('button', { name: /save name/i }).disabled).toBe(true) // nothing changed yet
  fireEvent.change(field, { target: { value: 'New' } })
  fireEvent.click(screen.getByRole('button', { name: /save name/i }))
  await waitFor(() => expect(patchAccount).toHaveBeenCalledWith({ name: 'New' }))
})

// The address IS the credential: asking mails the NEW one and changes nothing yet.
test('changing the email sends a link and says so, without changing anything', async () => {
  getAccount.mockResolvedValue({ id: 'ac1', email: 'me@x.test', name: 'Me', hasPassword: false })
  requestEmailChange.mockResolvedValue({ ok: true })
  render(<AccountSettings />)
  const field = await screen.findByLabelText('New email')
  fireEvent.change(field, { target: { value: 'new@x.test' } })
  fireEvent.click(screen.getByRole('button', { name: /send the link/i }))
  await waitFor(() => expect(requestEmailChange).toHaveBeenCalledWith('new@x.test'))
  expect(await screen.findByText(/link sent to/i)).toBeTruthy()
  expect(screen.getByText('me@x.test')).toBeTruthy() // still the one you sign in with
})

test('the address you already use cannot be re-sent to yourself', async () => {
  getAccount.mockResolvedValue({ id: 'ac1', email: 'me@x.test', name: 'Me', hasPassword: false })
  render(<AccountSettings />)
  const field = await screen.findByLabelText('New email')
  fireEvent.change(field, { target: { value: 'me@x.test' } })
  expect(screen.getByRole('button', { name: /send the link/i }).disabled).toBe(true)
})

test('an address another account holds is reported as such', async () => {
  getAccount.mockResolvedValue({ id: 'ac1', email: 'me@x.test', name: 'Me', hasPassword: false })
  requestEmailChange.mockRejectedValue(Object.assign(new Error('email_taken'), { code: 'email_taken' }))
  render(<AccountSettings />)
  fireEvent.change(await screen.findByLabelText('New email'), { target: { value: 'taken@x.test' } })
  fireEvent.click(screen.getByRole('button', { name: /send the link/i }))
  expect(await screen.findByText(/already belongs to another account/i)).toBeTruthy()
})
