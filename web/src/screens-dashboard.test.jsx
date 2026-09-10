import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'

// Same standalone header-token auth as the rest of the console — mock accountClient so
// these tests never touch fetch.
vi.mock('./lib/accountClient.js', () => ({
  getAccount: vi.fn(async () => ({ id: 'ac_1', email: 'you@x.test', name: 'Ada Lovelace' })),
  getAccountSweeps: vi.fn(),
  getAccountStats: vi.fn(),
  getBilling: vi.fn(),
  patchAccount: vi.fn(),
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  startCheckout: vi.fn(),
  openPortal: vi.fn(),
  clearAccountToken: vi.fn(),
  revokeSession: vi.fn(async () => ({})),
  revokeAllSessions: vi.fn(async () => ({})),
}))

import { Dashboard, cumulate, raceSeries, mergeJoins, mergeSeason } from './screens-dashboard.jsx'
import { getAccountSweeps, getAccountStats, getBilling } from './lib/accountClient.js'

const SWEEP = {
  id: 'sw1', name: 'Office Pool', role: 'owner', archivedAt: null,
  createdAt: '2026-01-04T00:00:00Z', wageringEnabled: false,
  members: { total: 2, registered: 1 },
  competition: { name: 'NBA 2025-26', sport: 'basketball', season: '2025-26', logo: null },
}

const STATS = {
  sweepId: 'sw1',
  people: [
    { id: 'pn_a', name: 'Ann Smith', initials: 'AS', avColor: '#e11', claimedAt: '2026-05-01T12:00:00.000Z' },
    { id: 'pn_b', name: 'Bo Tran', initials: 'BT', avColor: '#07a', claimedAt: null },
  ],
  joins: [
    { date: '2026-05-01', created: 2, claimed: 1 },
    { date: '2026-05-02', created: 0, claimed: 0 },
  ],
  race: [
    { personId: 'pn_a', date: '2026-05-02', wins: 1 },
    { personId: 'pn_a', date: '2026-05-03', wins: 2 },
    { personId: 'pn_b', date: '2026-05-03', wins: 1 },
  ],
  season: { final: 3, total: 5, next: '2026-09-17T02:12:44.756Z' },
  calls: [{ personId: 'pn_a', picks: 4, right: 3 }],
  activity: [
    { personId: 'pn_a', picks: 4, bets: 1, photos: 0 },
    { personId: 'pn_b', picks: 0, bets: 0, photos: 0 },
  ],
}

let originalLocation

beforeEach(() => {
  vi.clearAllMocks()
  getAccountSweeps.mockResolvedValue([SWEEP])
  getAccountStats.mockResolvedValue([STATS])
  // Paid up, so the billing panel the header carries says nothing — every test below
  // that cares about billing overrides this.
  getBilling.mockResolvedValue({ subscribed: true, subscriptionStatus: 'active', liveSweeps: 1 })
  originalLocation = window.location
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, assign: vi.fn(), reload: vi.fn() },
    configurable: true, writable: true,
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true })
})

// The rail lists every sweep you run by name too, so a bare getByText matches twice.
const pane = () => within(screen.getByRole('main'))

/* ---------------- the arithmetic ---------------- */
// The API ships raw daily buckets on purpose; every running total on this page is made
// here. Get this wrong and every chart lies quietly.
test('cumulate turns daily counts into a running total', () => {
  expect(cumulate([1, 0, 2])).toEqual([1, 1, 3])
  expect(cumulate([])).toEqual([])
})

test('the race stacks each person\'s daily wins into their own running total', () => {
  const series = raceSeries(STATS)
  expect(series.map((s) => [s.label, s.points])).toEqual([['AS', [1, 3]], ['BT', [0, 1]]])
})

// Whoever is in front carries the story; the rest are there to show the gap.
test('the race puts the leader first and dims everybody else', () => {
  const series = raceSeries(STATS)
  expect(series[0].dim).toBe(false)
  expect(series[1].dim).toBe(true)
  expect(series[0].color).toBe('#e11')
})

test('nobody with a win yet means no lines at all, not a row of flat zeros', () => {
  expect(raceSeries({ ...STATS, race: [] })).toEqual([])
})

test('several sweeps roll their join buckets into one series, by date', () => {
  expect(mergeJoins([
    { joins: [{ date: '2026-05-01', created: 2, claimed: 1 }] },
    { joins: [{ date: '2026-05-01', created: 1, claimed: 0 }, { date: '2026-04-30', created: 5, claimed: 5 }] },
  ])).toEqual([
    { date: '2026-04-30', created: 5, claimed: 5 },
    { date: '2026-05-01', created: 3, claimed: 1 },
  ])
})

test('several seasons roll up to the totals and the soonest kickoff of any of them', () => {
  expect(mergeSeason([
    { season: { final: 3, total: 5, next: '2026-09-17T00:00:00.000Z' } },
    { season: { final: 1, total: 9, next: '2026-09-12T00:00:00.000Z' } },
    { season: { final: 0, total: 0, next: null } },
  ])).toEqual({ final: 4, total: 14, next: '2026-09-12T00:00:00.000Z' })
})

/* ---------------- the page ---------------- */
test('the dashboard draws the race, the joins, the season and the loud ones', async () => {
  render(<Dashboard />)
  expect(await pane().findByRole('img', { name: /wins/i })).toBeTruthy()
  expect(pane().getByText(/3 of 5/)).toBeTruthy()
  expect(pane().getByText(/Ann Smith/)).toBeTruthy()
})

// A sweep whose season has not started is the most likely sweep to be looked at: it was
// just made. An empty box says nothing; the date of the first kickoff says everything.
test('before any game has finished the race names the first kickoff instead of drawing an empty box', async () => {
  getAccountStats.mockResolvedValue([{ ...STATS, race: [], season: { final: 0, total: 5, next: '2026-09-17T02:12:44.756Z' } }])
  render(<Dashboard />)
  // "Sep" or "Sept" depending on the ICU build — the date is the point, not the spelling
  expect(await pane().findByText(/it starts 17 Sep/i)).toBeTruthy()
  expect(pane().queryByRole('img', { name: /wins/i })).toBeNull()
})

test('an account that runs no sweeps gets the call to action, not six empty cards', async () => {
  getAccountSweeps.mockResolvedValue([])
  getAccountStats.mockResolvedValue([])
  render(<Dashboard />)
  expect(await pane().findByText(/no sweeps yet/i)).toBeTruthy()
  expect(pane().queryByRole('img', { name: /wins/i })).toBeNull()
})

// The dashboard is the risky half of this page and the rail is the useful half. One
// failing must not take the other down.
test('a failed stats load says so without taking the rail down with it', async () => {
  getAccountStats.mockRejectedValue(new Error('boom'))
  render(<Dashboard />)
  expect(await pane().findByText(/couldn't work out/i)).toBeTruthy()
  const rail = within(await screen.findByRole('navigation'))
  expect(rail.getByRole('link', { name: 'Office Pool' })).toHaveAttribute('href', '/account/s/sw1')
})

test('wagering off means no pulse card at all', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /wins/i })
  expect(pane().queryByText(/wagering/i)).toBeNull()
})

test('wagering on draws the bets, the biggest win and who leaves it latest', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: {
      daily: [{ date: '2026-05-01', bets: 2, staked: 15 }],
      biggest: { personId: 'pn_a', profit: 40 },
      lead: [{ personId: 'pn_a', medianSec: 2460 }],
    },
  }])
  render(<Dashboard />)
  expect(await pane().findByRole('img', { name: /bets/i })).toBeTruthy()
  expect(pane().getByText(/40/)).toBeTruthy()
  expect(pane().getByText(/41 minutes/)).toBeTruthy()
})

// The payload is per sweep, so with more than one there has to be a way to say which
// one the race is about — and the counts that do add up should add up.
test('several sweeps roll up in the header and offer a way to switch the race', async () => {
  getAccountSweeps.mockResolvedValue([SWEEP, { ...SWEEP, id: 'sw2', name: 'Family League' }])
  getAccountStats.mockResolvedValue([
    STATS,
    { ...STATS, sweepId: 'sw2', race: [], season: { final: 2, total: 5, next: null } },
  ])
  render(<Dashboard />)
  const picker = await pane().findByRole('combobox', { name: /showing/i })
  expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Office Pool', 'Family League'])
  // 3 of 5 and 2 of 5, rolled up
  expect(pane().getByText(/5 of 10/)).toBeTruthy()
})

// /account is where the sweep page's read-only warning, the catalog's "Go to billing"
// and every return out of Stripe land. A lapsed owner following one of those used to
// arrive at a page of charts with nothing to pay with.
test('a lapsed owner landing on the dashboard is handed the bill, not just charts', async () => {
  getBilling.mockResolvedValue({ subscribed: false, trialEndsAt: '2026-01-01T00:00:00Z', liveSweeps: 1 })
  render(<Dashboard />)
  expect(await pane().findByText(/trial has ended/i)).toBeTruthy()
  expect(pane().getByRole('button', { name: /subscribe/i })).toBeTruthy()
})

test('a paid-up account gets its charts and no invoice', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /wins/i })
  expect(pane().queryByText(/subscription/i)).toBeNull()
})

test('the dashboard keeps a way through to the list and the billing on it', async () => {
  render(<Dashboard />)
  await waitFor(() => expect(getAccountStats).toHaveBeenCalled())
  expect(pane().getByRole('link', { name: /sweeps and billing/i })).toHaveAttribute('href', '/account/sweeps')
})
