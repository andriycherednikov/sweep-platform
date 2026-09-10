import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// The account shell is header-token auth, separate from the sweep session —
// mock accountClient so these tests never touch fetch.
vi.mock('./lib/accountClient.js', () => ({
  getAccount: vi.fn(async () => ({ id: 'ac_1', email: 'you@x.test', name: 'Ada Lovelace' })),
  getBilling: vi.fn(),
  getAccountSweeps: vi.fn(),
  patchAccount: vi.fn(),
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  startCheckout: vi.fn(),
  openPortal: vi.fn(),
  clearAccountToken: vi.fn(),
  revokeSession: vi.fn(async () => ({})),
  revokeAllSessions: vi.fn(async () => ({})),
}))

import { AccountHome, AccountSettings, BillingNotice } from './screens-account.jsx'
import {
  getAccount, getBilling, getAccountSweeps, startCheckout, openPortal, clearAccountToken,
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

// The rail lists every sweep you run by name as well, so a bare getByText(name) matches
// twice. Assertions about the page itself are scoped to the paper pane; the rail has its
// own tests at the bottom of this file.
const pane = () => within(screen.getByRole('main'))

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
  fireEvent.click(screen.getByRole('button', { name: /^log out$/i }))
  await waitFor(() => expect(revokeSession).toHaveBeenCalled())
  expect(revokeAllSessions).not.toHaveBeenCalled()
  expect(clearAccountToken).toHaveBeenCalled()
  expect(window.location.reload).toHaveBeenCalled()
})

test('sign out everywhere revokes every session, clears the token and reloads', async () => {
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^settings$/i }))
  fireEvent.click(screen.getByRole('button', { name: /log out everywhere/i }))
  await waitFor(() => expect(revokeAllSessions).toHaveBeenCalled())
  expect(revokeSession).not.toHaveBeenCalled()
  expect(clearAccountToken).toHaveBeenCalled()
  expect(window.location.reload).toHaveBeenCalled()
})

test('sign out still clears locally and reloads even when the server revoke fails', async () => {
  revokeSession.mockRejectedValueOnce(new Error('network'))
  render(<AccountHome />)
  fireEvent.click(await screen.findByRole('button', { name: /^settings$/i }))
  fireEvent.click(screen.getByRole('button', { name: /^log out$/i }))
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
  fireEvent.click(screen.getByRole('button', { name: /log out everywhere/i }))
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
  await pane().findByText('My NBA')
  fireEvent.click(screen.getByRole('button', { name: /new sweep/i }))
  expect(window.location.assign).toHaveBeenCalledWith('/account/new')
})

// The row is a summary now, not a control panel: the member link, Replace link and
// Archive all moved to the sweep's own page, and Settings is the way to them.
test('a sweep card reports who has joined, and hands the controls to the sweep\'s own page', async () => {
  getAccountSweeps.mockResolvedValue([{
    id: 'sw_1', name: 'Office', competitionId: 'c', archivedAt: null, createdAt: null, role: 'owner',
    memberLink: 'https://x.test/g/tok', members: { total: 12, registered: 8 },
  }])
  render(<AccountHome />)
  expect(await screen.findByText(/12 in the sweep/)).toBeInTheDocument()
  expect(screen.getByText(/4 not joined yet/)).toBeInTheDocument()
  expect(pane().getByRole('link', { name: /^settings$/i })).toHaveAttribute('href', '/account/s/sw_1')
  expect(pane().queryByDisplayValue('https://x.test/g/tok')).toBeNull()
  expect(pane().queryByRole('button', { name: /^archive$/i })).toBeNull()
  expect(pane().queryByRole('button', { name: /replace link/i })).toBeNull()
})

// Billing is ONE account-level subscription whose quantity is the number of running
// sweeps. A Cancel on every card taught the owner that sweeps are billed one by one,
// and pressing any of them stopped the subscription behind all of them.
test('twelve sweeps do not offer twelve ways to cancel one subscription', async () => {
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'active', trialEndsAt: null, liveSweeps: 3, quantity: 3 })
  getAccountSweeps.mockResolvedValue([1, 2, 3].map((i) => ownedSweep(i)))
  render(<AccountHome here="sweeps" />)
  await pane().findByText('Sweep 1')
  expect(pane().getAllByRole('button', { name: /manage billing/i })).toHaveLength(1)
  expect(pane().queryByRole('button', { name: /cancel subscription/i })).toBeNull()
  // and the state that IS per sweep stays on the card
  expect(pane().getAllByText('Paid')).toHaveLength(3)
})

// It used to appear only on an account with no sweeps — which is the one account with
// nothing to bill. Every "subscribe" link in the app lands on this page.
test('the account subscription is on the list page whether or not there are sweeps', async () => {
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'active', trialEndsAt: null, liveSweeps: 1, quantity: 1 })
  getAccountSweeps.mockResolvedValue([ownedSweep(1)])
  render(<AccountHome here="sweeps" />)
  expect(await pane().findByText(/the sweep subscription/i)).toBeTruthy()
})

// The row's "Subscribe to reopen" was the only thing on the card saying why the sweep
// had gone read-only. Taking the button off must not take the sentence with it.
test('a lapsed account is told why its sweeps are read-only, and how to fix it, once', async () => {
  const past = new Date(Date.now() - 86400000).toISOString()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: past, liveSweeps: 2, quantity: 0 })
  getAccountSweeps.mockResolvedValue([ownedSweep(1), ownedSweep(2)])
  render(<AccountHome here="sweeps" />)
  expect(await pane().findByText(/trial has ended — sweeps are read-only/i)).toBeTruthy()
  expect(pane().getAllByText('Read-only')).toHaveLength(2)
  expect(pane().getAllByRole('button', { name: /^subscribe$/i })).toHaveLength(1)
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
  expect(await pane().findByText('My NBA')).toBeTruthy()
  expect(pane().getByText('Office Footy')).toBeTruthy()
  expect(pane().getByText(/sweeps you run/i)).toBeTruthy()
  expect(pane().getByText(/sweeps you're in/i)).toBeTruthy()
  expect(pane().getByRole('link', { name: /office footy/i })).toHaveAttribute('href', '/s/sw2')
})

// A member has no billing, no link to hand out and nothing to archive — those belong
// to whoever runs it.
test('a sweep you only play in carries none of the owner controls', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw2', name: 'Office Footy', competitionId: 'c2', archivedAt: null, createdAt: 'x', role: 'member' },
  ])
  render(<AccountHome />)
  expect(await pane().findByText('Office Footy')).toBeTruthy()
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

// The gear is the app's only sign-out and its only route to /account/settings. It hung
// off `who &&`, so a failed GET /api/account — swallowed, by design, because the page
// beside the rail reports its own errors — took the way out with it.
test('the way out of the app does not hang on the request that says who you are', async () => {
  getAccount.mockRejectedValue(new Error('boom'))
  render(<AccountHome here="sweeps" />)
  fireEvent.click(await screen.findByRole('button', { name: /^settings$/i }))
  expect(screen.getByRole('button', { name: /account settings/i })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^log out$/i }))
  await waitFor(() => expect(clearAccountToken).toHaveBeenCalled())
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
  render(<AccountHome />)
  await pane().findByText('The Lads')
  const text = screen.getByRole('main').textContent
  expect(text.indexOf('The Lads')).toBeLessThan(text.indexOf("You don't run one yet"))
})

// One thing to do with a sweep you only play in, so the whole row is the target —
// a real <a> so cmd-click and the keyboard keep working.
test('a sweep you are in is clickable across the whole row', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw2', name: 'The Lads', role: 'member', archivedAt: null, competition: null },
  ])
  render(<AccountHome />)
  const row = (await pane().findByText('The Lads')).closest('a')
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
  const name = (await pane().findByText('Office Pool')).closest('a')
  expect(name.getAttribute('href')).toBe('/s/sw1')
  expect(screen.getByLabelText('Open Office Pool').getAttribute('href')).toBe('/s/sw1')
})

/* ---- the bill, where the "subscribe" links land ---------------------------- */
// /account is the dashboard now, and the dashboard never reads billing — but the
// read-only warning on a sweep's page, the catalog's "Go to billing" and every "Back to
// my account" out of Stripe still point at it. A lapsed owner following the warning
// arrived at a page of charts with no way to pay. Mounted from the dashboard; the
// behaviour is pinned here, where it is written.
test('a lapsed account is handed the bill on the page its subscribe links land on', async () => {
  const past = new Date(Date.now() - 86400000).toISOString()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: past, liveSweeps: 2, quantity: 0 })
  render(<BillingNotice />)
  expect(await screen.findByText(/trial has ended — sweeps are read-only/i)).toBeTruthy()
  expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeTruthy()
})

test('a trialing account is shown what it has left, and how to keep it', async () => {
  const future = new Date(Date.now() + 4 * 86400000).toISOString()
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: future, liveSweeps: 1, quantity: 0 })
  render(<BillingNotice />)
  expect(await screen.findByText(/days left in your free trial/i)).toBeTruthy()
})

test('a failed payment is worth interrupting a paid-up account for', async () => {
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'past_due', trialEndsAt: null, liveSweeps: 1, quantity: 1 })
  render(<BillingNotice />)
  expect(await screen.findByText(/last payment failed/i)).toBeTruthy()
})

// Nothing to do about it — and this is the page that exists to be fun. The dashboard's
// own header already carries a quiet link to the list, where the controls live.
test('a paid-up account is not shown a bill on its dashboard', async () => {
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'active', trialEndsAt: null, liveSweeps: 2, quantity: 2 })
  const { container } = render(<BillingNotice />)
  await waitFor(() => expect(getBilling).toHaveBeenCalled())
  expect(container.textContent).toBe('')
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

/* ---- the console rail ------------------------------------------------------ */
// One nav item called "Sweeps" made the rail a label for the page beside it. The rail
// is the console's index: the sweeps you run are in it by name, and each one is the way
// to its own settings.
const rail = async () => within(await screen.findByRole('navigation'))

const ownedSweep = (i, over = {}) => ({
  id: `sw${i}`, name: `Sweep ${i}`, role: 'owner', archivedAt: null,
  createdAt: `2026-01-0${i}T00:00:00Z`, memberLink: `https://h/g/${i}`,
  members: { total: 2, registered: 2 }, competition: null, ...over,
})

test('the rail lists the sweeps you run, each linking to its own page', async () => {
  getAccountSweeps.mockResolvedValue([
    ownedSweep(1, { name: 'Office Pool', competition: { name: 'NBA 2025-26', sport: 'basketball', logo: '/nba.png' } }),
  ])
  render(<AccountHome />)
  expect((await rail()).getByRole('link', { name: /office pool/i })).toHaveAttribute('href', '/account/s/sw1')
})

// Nothing on this side to configure — the roster, the link and the billing are the
// owner's — so a sweep you are only in goes straight into the app.
test('a sweep you are only in goes straight into the sweep, not to a settings page', async () => {
  getAccountSweeps.mockResolvedValue([
    { id: 'sw9', name: "Dave's pool", role: 'member', archivedAt: null, createdAt: '2026-02-01T00:00:00Z', competition: null },
  ])
  render(<AccountHome />)
  expect((await rail()).getByRole('link', { name: /dave's pool/i })).toHaveAttribute('href', '/s/sw9')
})

// The owned half of GET /api/account/sweeps has no archived filter server-side, so the
// rail has to do it — an archived sweep is off the list page and must be off the rail.
test('an archived sweep you own is not in the rail', async () => {
  getAccountSweeps.mockResolvedValue([
    ownedSweep(1, { name: 'Live One' }),
    ownedSweep(2, { name: 'Old One', archivedAt: '2026-01-01T00:00:00Z' }),
  ])
  render(<AccountHome />)
  const nav = await rail()
  expect(nav.getByRole('link', { name: /live one/i })).toBeTruthy()
  expect(nav.queryByRole('link', { name: /old one/i })).toBeNull()
})

// The route has no ORDER BY, so Postgres hands them back in whatever order it likes.
// A rail that reshuffles itself between page loads is unusable.
test('the rail is in a stable order, newest first', async () => {
  getAccountSweeps.mockResolvedValue([ownedSweep(1), ownedSweep(3), ownedSweep(2)])
  render(<AccountHome />)
  const hrefs = (await rail()).getAllByRole('link', { name: /^Sweep \d$/ }).map((a) => a.getAttribute('href'))
  expect(hrefs).toEqual(['/account/s/sw3', '/account/s/sw2', '/account/s/sw1'])
})

test('a handful of sweeps are all listed, with no overflow item', async () => {
  getAccountSweeps.mockResolvedValue([1, 2, 3].map((i) => ownedSweep(i)))
  render(<AccountHome />)
  const nav = await rail()
  expect(nav.getAllByRole('link', { name: /^Sweep \d$/ })).toHaveLength(3)
  expect(nav.queryByRole('link', { name: /all \d+ sweeps/i })).toBeNull()
})

test('past six, the rail stops listing and offers the whole list instead', async () => {
  getAccountSweeps.mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8].map((i) => ownedSweep(i)))
  render(<AccountHome />)
  const nav = await rail()
  expect(nav.getAllByRole('link', { name: /^Sweep \d$/ })).toHaveLength(6)
  expect(nav.getByRole('link', { name: /all 8 sweeps/i })).toBeTruthy()
})

// The cap was on the wrong list, or rather on only half of it: you run a handful of
// sweeps and you join other people's, so the side that actually grows was the one
// listed to the end with no overflow item to escape by.
test("the sweeps you are in are capped and overflow the same way the ones you run do", async () => {
  getAccountSweeps.mockResolvedValue(
    [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ownedSweep(i, { role: 'member', name: `In ${i}` })),
  )
  render(<AccountHome here="sweeps" />)
  const nav = await rail()
  expect(nav.getAllByRole('link', { name: /^In \d$/ })).toHaveLength(6)
  expect(nav.getByRole('link', { name: /all 8 sweeps you're in/i })).toHaveAttribute('href', '/account/sweeps')
})

test('a handful of sweeps you are in are all listed, with no overflow item', async () => {
  getAccountSweeps.mockResolvedValue([1, 2].map((i) => ownedSweep(i, { role: 'member', name: `In ${i}` })))
  render(<AccountHome here="sweeps" />)
  const nav = await rail()
  expect(nav.getAllByRole('link', { name: /^In \d$/ })).toHaveLength(2)
  expect(nav.queryByRole('link', { name: /all \d+ sweeps/i })).toBeNull()
})

// At <=820px the rail turns into a horizontal strip, which survives two items and not
// twelve. The same sweeps ride along as a native picker: no drawer to build, and the
// keyboard and VoiceOver work without being asked.
test('the rail doubles as a native picker for the phone, and it navigates', async () => {
  getAccountSweeps.mockResolvedValue([
    ownedSweep(1, { name: 'Office Pool' }),
    { id: 'sw9', name: "Dave's pool", role: 'member', archivedAt: null, createdAt: '2026-02-01T00:00:00Z', competition: null },
  ])
  render(<AccountHome />)
  const pick = await screen.findByRole('combobox', { name: /go to/i })
  expect(within(pick).getByRole('option', { name: 'Office Pool' })).toBeTruthy()
  expect(within(pick).getByRole('option', { name: "Dave's pool" })).toBeTruthy()
  // Picking is not going: a <select> that navigates on change is a change of context on
  // input, and in a browser where the arrow keys move a closed select it puts every
  // option past the adjacent one out of the keyboard's reach.
  fireEvent.change(pick, { target: { value: '/account/s/sw1' } })
  expect(window.location.assign).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /^go$/i }))
  expect(window.location.assign).toHaveBeenCalledWith('/account/s/sw1')
})
