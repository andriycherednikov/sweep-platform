import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// Same standalone header-token auth as the rest of the console — mock accountClient so
// these tests never touch fetch.
vi.mock('./lib/accountClient.js', () => ({
  getAccount: vi.fn(async () => ({ id: 'ac_1', email: 'you@x.test', name: 'Ada Lovelace' })),
  getAccountSweeps: vi.fn(),
  getAccountStats: vi.fn(),
  patchSweep: vi.fn(async () => ({ ok: true })),
  archiveSweep: vi.fn(async () => ({})),
  rotateSweep: vi.fn(async () => ({ memberLink: 'https://h/g/new' })),
  clearAccountToken: vi.fn(),
  revokeSession: vi.fn(async () => ({})),
  revokeAllSessions: vi.fn(async () => ({})),
}))

import { SweepSettings } from './screens-sweep-settings.jsx'
import { getAccountSweeps, getAccountStats, patchSweep, archiveSweep, rotateSweep } from './lib/accountClient.js'

const SWEEP = {
  id: 'sw1', name: 'Office Pool', role: 'owner', archivedAt: null,
  createdAt: '2026-01-04T00:00:00Z', memberLink: 'https://h/g/old',
  wageringEnabled: false, members: { total: 14, registered: 11 },
  competition: { name: 'NBA 2025-26', sport: 'basketball', season: '2025-26', logo: null },
}

const STATS = {
  sweepId: 'sw1',
  people: [{ id: 'pn_a', name: 'Ann Smith', initials: 'AS', avColor: '#e11', claimedAt: '2026-05-01T12:00:00.000Z' }],
  // Two days of everything: one day is one column, which the cards deliberately state
  // as a number rather than draw (screens-dashboard.jsx), and this test is about the
  // charts being here at all.
  joins: [{ date: '2026-05-01', created: 2, claimed: 1 }, { date: '2026-05-02', created: 0, claimed: 1 }],
  race: [{ personId: 'pn_a', date: '2026-05-02', wins: 2 }, { personId: 'pn_a', date: '2026-05-03', wins: 1 }],
  season: { final: 3, total: 5, next: null },
  calls: [{ personId: 'pn_a', picks: 4, right: 3 }],
  // No photo count: a fan photo is written with a null person_id, so the only thing a
  // per-person tally could count was avatars, and the route stopped sending it.
  activity: [{ personId: 'pn_a', picks: 4, bets: 0 }],
}

let originalLocation

beforeEach(() => {
  vi.clearAllMocks()
  getAccountSweeps.mockResolvedValue([SWEEP])
  getAccountStats.mockResolvedValue([STATS])
  patchSweep.mockResolvedValue({ ok: true })
  archiveSweep.mockResolvedValue({})
  rotateSweep.mockResolvedValue({ memberLink: 'https://h/g/new' })
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

const pane = () => within(screen.getByRole('main'))

test('the page opens on the sweep it names, with what it follows and how long it has run', async () => {
  render(<SweepSettings id="sw1" />)
  // Scoped: the rail's picker is standing on this sweep too, so its selected option
  // carries the same display value.
  expect(await pane().findByDisplayValue('Office Pool')).toBeTruthy()
  expect(pane().getByText('NBA 2025-26')).toBeTruthy()
  expect(pane().getByText(/running since .*2026.*14 in the sweep/i)).toBeTruthy()
})

// PATCH /api/account/sweeps/:id has existed since it was written with no client wrapper
// and no UI behind it: renaming your own sweep was an operator-console-only power.
test('the name is editable in place and saves on blur', async () => {
  render(<SweepSettings id="sw1" />)
  const field = await screen.findByLabelText(/sweep name/i)
  fireEvent.change(field, { target: { value: 'The Lads' } })
  fireEvent.blur(field)
  await waitFor(() => expect(patchSweep).toHaveBeenCalledWith('sw1', { name: 'The Lads' }))
})

test('a name that did not change is not saved', async () => {
  render(<SweepSettings id="sw1" />)
  fireEvent.blur(await screen.findByLabelText(/sweep name/i))
  expect(patchSweep).not.toHaveBeenCalled()
})

// The PATCH sits behind ownedSweep(requireLive:true), so a lapsed owner gets a 403.
// "Something went wrong" would send them to retry a thing that cannot work until they
// subscribe — say which of the two it is.
test('a lapsed owner is told why the rename did not take, not just that it failed', async () => {
  patchSweep.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403, code: 'sweep_readonly' }))
  render(<SweepSettings id="sw1" />)
  const field = await screen.findByLabelText(/sweep name/i)
  fireEvent.change(field, { target: { value: 'The Lads' } })
  fireEvent.blur(field)
  expect(await pane().findByText(/read-only/i)).toBeTruthy()
  expect(pane().queryByText(/something went wrong/i)).toBeNull()
  expect(pane().getByRole('link', { name: /subscribe/i })).toHaveAttribute('href', '/account/sweeps')
})

// The sweep's name is an <input>, so the page had no heading at all: nothing for a
// screen-reader user navigating by headings to land on, and an outline starting at h2.
test('the page has an h1, and it is the sweep', async () => {
  render(<SweepSettings id="sw1" />)
  expect(await screen.findByRole('heading', { level: 1, name: 'Office Pool' })).toBeTruthy()
  // and renaming it is still one click on the name itself
  expect(screen.getByLabelText(/sweep name/i)).toBeTruthy()
})

// The heading says what the sweep IS called, so it moves when the save lands — not
// while the owner is still typing, and not at all if the server refuses.
test('the heading follows the name that saved, not the one being typed', async () => {
  render(<SweepSettings id="sw1" />)
  const field = await screen.findByLabelText(/sweep name/i)
  fireEvent.change(field, { target: { value: 'The Lads' } })
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Office Pool')
  fireEvent.blur(field)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The Lads'))
})

// The wagering toggle beside it already does this. A heading left showing a name the
// sweep does not have is worse than a toggle left in the wrong position: it is the name
// the owner will go on calling it, and every other screen disagrees.
test('a rename the server refuses springs back to the saved name', async () => {
  patchSweep.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403, code: 'sweep_readonly' }))
  render(<SweepSettings id="sw1" />)
  const field = await screen.findByLabelText(/sweep name/i)
  fireEvent.change(field, { target: { value: 'The Lads' } })
  fireEvent.blur(field)
  await waitFor(() => expect(field.value).toBe('Office Pool'))
  expect(pane().getByText(/read-only/i)).toBeTruthy()
})

// The first UI anywhere for turning wagering on after the sweep was created: it was a
// provision-time decision, and POST /api/admin/wagering needs a sweep cookie to reach.
test('wagering can be switched on from here, and the switch follows the sweep', async () => {
  render(<SweepSettings id="sw1" />)
  const toggle = await screen.findByLabelText(/wagering/i)
  expect(toggle.checked).toBe(false)
  fireEvent.click(toggle)
  await waitFor(() => expect(patchSweep).toHaveBeenCalledWith('sw1', { wageringEnabled: true }))
  expect(toggle.checked).toBe(true)
})

test('a wagering toggle the server refuses springs back rather than lying', async () => {
  patchSweep.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403, code: 'sweep_readonly' }))
  render(<SweepSettings id="sw1" />)
  const toggle = await screen.findByLabelText(/wagering/i)
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle.checked).toBe(false))
  expect(pane().getByText(/read-only/i)).toBeTruthy()
})

test('the member link is here to be handed out, and can be replaced after a warning', async () => {
  render(<SweepSettings id="sw1" />)
  expect(await screen.findByDisplayValue('https://h/g/old')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^replace link$/i }))
  expect(rotateSweep).not.toHaveBeenCalled() // one tap warns, it does not rotate
  expect(pane().getByText(/locked out/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /yes, replace the link/i }))
  await waitFor(() => expect(rotateSweep).toHaveBeenCalledWith('sw1'))
  expect(await screen.findByDisplayValue('https://h/g/new')).toBeTruthy()
})

// The roster, the draw and the bet queue are not liftable into this console — they read
// the S global SweepProvider fills and call routes that want the sweep cookie. They are
// linked instead, each labelled with the number that makes it worth clicking.
test('the roster, the draw and the queue are linked into the sweep, the roster with its count', async () => {
  render(<SweepSettings id="sw1" />)
  const members = await pane().findByRole('link', { name: /members/i })
  expect(members).toHaveAttribute('href', '/s/sw1/admin')
  expect(members.textContent).toMatch(/14 in the sweep/)
  expect(members.textContent).toMatch(/3 not joined yet/)
  expect(pane().getByRole('link', { name: /run the draw/i })).toHaveAttribute('href', '/s/sw1/admin')
  expect(pane().getByRole('link', { name: /photos & open bets/i })).toHaveAttribute('href', '/s/sw1/admin')
})

test('a sweep everyone has joined is not nagged about it', async () => {
  getAccountSweeps.mockResolvedValue([{ ...SWEEP, members: { total: 6, registered: 6 } }])
  render(<SweepSettings id="sw1" />)
  expect(await pane().findByRole('link', { name: /members/i })).toBeTruthy()
  expect(pane().queryByText(/not joined yet/)).toBeNull()
})

// Billing is ONE account-level subscription whose quantity is the number of running
// sweeps. A Cancel button on each of twelve sweep pages would teach the owner that
// sweeps are billed one by one, and pressing it would stop all twelve.
test('there are no billing controls here — one subscription, priced by the account', async () => {
  render(<SweepSettings id="sw1" />)
  await pane().findByDisplayValue('Office Pool')
  expect(pane().queryByRole('button', { name: /cancel subscription/i })).toBeNull()
  expect(pane().queryByRole('button', { name: /subscribe/i })).toBeNull()
  expect(pane().queryByRole('button', { name: /manage billing/i })).toBeNull()
  // /account/sweeps, not /account: /account is the dashboard, which shows the bill only
  // when there is something to do about it. The controls are on the list, always.
  expect(pane().getByRole('link', { name: /billed with your account/i })).toHaveAttribute('href', '/account/sweeps')
})

test('archiving takes two taps and lands back on the list', async () => {
  render(<SweepSettings id="sw1" />)
  fireEvent.click(await screen.findByRole('button', { name: /^archive$/i }))
  expect(archiveSweep).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /really archive\?/i }))
  await waitFor(() => expect(archiveSweep).toHaveBeenCalledWith('sw1'))
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/account'))
})

// 404s server-side for a sweep you do not own, so the id cannot be probed. The page
// says the same thing rather than rendering an empty form.
test('a sweep you do not run says so instead of rendering a form', async () => {
  getAccountSweeps.mockResolvedValue([])
  render(<SweepSettings id="sw_nope" />)
  expect(await pane().findByText(/not a sweep you run/i)).toBeTruthy()
  expect(screen.queryByLabelText(/sweep name/i)).toBeNull()
})

test('the rail marks the sweep you are standing on', async () => {
  render(<SweepSettings id="sw1" />)
  const nav = within(await screen.findByRole('navigation'))
  expect(nav.getByRole('link', { name: /office pool/i }).className).toMatch(/is-here/)
})

// The console's front page tells the story of whichever sweep you picked; this page is
// about ONE sweep, so it tells that sweep's — the same cards, no second implementation.
test("the sweep's own page carries the sweep's own charts", async () => {
  render(<SweepSettings id="sw1" />)
  expect(await pane().findByRole('img', { name: /wins/i })).toBeTruthy()
  expect(pane().getByText(/3 of 5/)).toBeTruthy()
})

// The route ships a bucket for the days somebody was added or joined and nothing at all
// for the rest, so a chart drawn straight off those buckets spaces a fortnight of silence
// like one quiet day. The dashboard filled the gaps at the call site, which left the same
// card drawing two different axes depending which page it was on.
test("the joins chart puts a column on every day, not just the busy ones", async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    joins: [{ date: '2026-05-01', created: 2, claimed: 0 }, { date: '2026-05-04', created: 0, claimed: 2 }],
  }])
  render(<SweepSettings id="sw1" />)
  const svg = await pane().findByRole('img', { name: /seats invited/i })
  // Four days from the first bucket to the last, so four points on the line.
  expect(svg.querySelector('path').getAttribute('d').split(' ')).toHaveLength(4)
})

// The charts are the decorative half of this page and the settings are the half
// somebody came here to change. Losing one must not cost the other.
test('a failed stats load leaves the settings working', async () => {
  getAccountStats.mockRejectedValue(new Error('boom'))
  render(<SweepSettings id="sw1" />)
  expect(await pane().findByDisplayValue('Office Pool')).toBeTruthy()
  expect(pane().getByRole('button', { name: /replace link/i })).toBeTruthy()
  expect(pane().queryByRole('img', { name: /wins/i })).toBeNull()
  // And the missing half leaves no hole behind it. The page emitted the story column
  // either way, so on a wide screen the settings ended up crammed into 380px against
  // the right-hand edge with two thirds of the pane blank: one child, not two.
  expect(document.querySelector('.ac-sweep').children).toHaveLength(1)
})

// Same again with nothing to blame: the request lands, and simply has no row for this
// sweep. There is no story either way, so there is no column either way.
test('a sweep the stats have no row for is one column too', async () => {
  getAccountStats.mockResolvedValue([{ ...STATS, sweepId: 'sw_other' }])
  render(<SweepSettings id="sw1" />)
  expect(await pane().findByDisplayValue('Office Pool')).toBeTruthy()
  await waitFor(() => expect(document.querySelector('.ac-sweep').children).toHaveLength(1))
})
