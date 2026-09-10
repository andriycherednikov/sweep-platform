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

import { Dashboard, cumulate, raceSeries, fillJoins } from './screens-dashboard.jsx'
import { getAccountSweeps, getAccountStats, getBilling } from './lib/accountClient.js'

const SWEEP = {
  id: 'sw1', name: 'Office Pool', role: 'owner', archivedAt: null,
  createdAt: '2026-01-04T00:00:00Z', wageringEnabled: false,
  members: { total: 2, registered: 1 },
  competition: { name: 'NBA 2025-26', sport: 'basketball', season: '2025-26', logo: null },
}

const STATS = {
  sweepId: 'sw1',
  competitionId: 'cp_nba',
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
  // No photo count: a fan photo is written with a null person_id, so the only thing a
  // per-person tally could count was avatars, and the route stopped sending it.
  activity: [
    { personId: 'pn_a', picks: 4, bets: 1 },
    { personId: 'pn_b', picks: 0, bets: 0 },
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

// The route ships only the days something happened on. Plotted straight off those
// buckets every chart on the page spaces them evenly, so a fortnight of international
// break reads as one quiet day and the axis stops being a calendar at all.
test('the race puts a column on every day between the first win and the last', () => {
  const series = raceSeries({
    ...STATS,
    race: [
      { personId: 'pn_a', date: '2026-05-01', wins: 1 },
      { personId: 'pn_a', date: '2026-05-05', wins: 2 },
    ],
  })
  expect(series.map((x) => x.points)).toEqual([[1, 1, 1, 1, 3]])
})

// The route ships only the days something happened on. Plotted straight off those
// buckets the joins chart spaces them evenly, so a fortnight of silence reads as one
// quiet day and the axis stops being a calendar at all.
test('the days nobody joined on are in the series too, as the flat bit they were', () => {
  expect(fillJoins([
    { date: '2026-05-01', created: 2, claimed: 0 },
    { date: '2026-05-04', created: 0, claimed: 2 },
  ])).toEqual([
    { date: '2026-05-01', created: 2, claimed: 0 },
    { date: '2026-05-02', created: 0, claimed: 0 },
    { date: '2026-05-03', created: 0, claimed: 0 },
    { date: '2026-05-04', created: 0, claimed: 2 },
  ])
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

// Whoever has done nothing is the half of that card worth acting on, so their row is a
// link into the sweep's admin. Adding an absent photo count into the total made it NaN,
// which is not zero, and every quiet row quietly stopped being a link.
test('the quiet ones are the rows you can go and poke', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /wins/i })
  expect(pane().getByRole('link', { name: /Bo Tran/ })).toHaveAttribute('href', '/s/sw1/admin')
  expect(pane().getByText('4 picks · 1 bet')).toBeTruthy()
})

// Both charts are drawn from tables with no history in them, and on a page whose whole
// job is entertainment a caption is cheaper than a schema change — but it has to be
// there, or the chart quietly claims to remember something it cannot.
test('the race admits it credits every win to whoever holds the team now', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /wins/i })
  expect(pane().getByText(/changes hands/i)).toBeTruthy()
})

test('the luck card admits the feed can rewrite what it divides by', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /luck/i })
  expect(pane().getByText(/drops the pick with it/i)).toBeTruthy()
})

// The other way round from the test above: the charts are the half that landed. The
// rail has nothing in it and no row can be ranked against a list that never arrived, so
// this is the path where every sweep falls back to the same place in the order.
test('the charts still draw when the sweep list is the half that fell over', async () => {
  getAccountSweeps.mockRejectedValue(new Error('boom'))
  getAccountStats.mockResolvedValue([STATS, { ...STATS, sweepId: 'sw2', competitionId: 'cp_nfl' }])
  render(<Dashboard />)
  expect(await pane().findByRole('img', { name: /wins/i })).toBeTruthy()
  const picker = pane().getByRole('combobox', { name: /showing/i })
  expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Your sweep', 'Your sweep'])
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
      daily: [{ date: '2026-05-01', bets: 2, staked: 15 }, { date: '2026-05-02', bets: 1, staked: 5 }],
      biggest: { personId: 'pn_a', profit: 40 },
      lead: [{ personId: 'pn_a', medianSec: 2460 }],
    },
  }])
  render(<Dashboard />)
  expect(await pane().findByRole('img', { name: /bets/i })).toBeTruthy()
  expect(pane().getByText(/40/)).toBeTruthy()
  expect(pane().getByText(/41 minutes/)).toBeTruthy()
})

// Same lie, drawn as bars: two busy days a week apart are two bars side by side unless
// the quiet days in between are in the array.
test('the bets-per-day bars keep a slot for the days nobody had a bet on', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: {
      daily: [{ date: '2026-05-01', bets: 2, staked: 15 }, { date: '2026-05-04', bets: 1, staked: 5 }],
      biggest: null,
      lead: [],
    },
  }])
  const { container } = render(<Dashboard />)
  await pane().findByRole('img', { name: /bets/i })
  expect(container.querySelectorAll('.ac-grid rect')).toHaveLength(4)
  expect(pane().getByText(/3 bets · 20 coins staked/)).toBeTruthy()
})

// The payload is per sweep, so with more than one there has to be a way to say which one
// the page is about — and then every card on it has to mean that one. "Getting in" and
// "The season" used to stay rolled up across every sweep the account runs, so the seat
// count and the games-played bar described a different group from the heading directly
// above them, and "The season" — singular — was the fixtures of every unrelated
// competition the account follows added into one number.
test('several sweeps offer a way to switch, and every card follows the picker', async () => {
  getAccountSweeps.mockResolvedValue([SWEEP, { ...SWEEP, id: 'sw2', name: 'Family League' }])
  getAccountStats.mockResolvedValue([
    STATS,
    {
      ...STATS, sweepId: 'sw2', competitionId: 'cp_nfl', race: [],
      joins: [{ date: '2026-05-01', created: 9, claimed: 0 }],
      season: { final: 2, total: 5, next: null },
    },
  ])
  render(<Dashboard />)
  const picker = await pane().findByRole('combobox', { name: /showing/i })
  expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Office Pool', 'Family League'])
  // Office Pool's own 3 of 5, not the 5 of 10 the two seasons made together.
  expect(pane().getByText(/3 of 5/)).toBeTruthy()
  expect(pane().queryByText(/5 of 10/)).toBeNull()
  // And its own one unclaimed seat, not the ten the two rosters made together.
  expect(pane().getByText(/1 seat still/)).toBeTruthy()
  expect(pane().queryByText(/10 seats still/)).toBeNull()
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

/* ---------------- one day of data is not a chart ---------------- */
// A sweep made this morning has every seat, every win and every bet stamped with the
// same date, which is one column — and a line through one point draws literally
// nothing. Every card here would rather say the number than hand back an empty box.
test('seats all added on one day get the count, not a line through one point', async () => {
  getAccountStats.mockResolvedValue([{ ...STATS, joins: [{ date: '2026-05-01', created: 3, claimed: 1 }] }])
  render(<Dashboard />)
  expect(await pane().findByText(/1 of 3/)).toBeTruthy()
  expect(pane().queryByRole('img', { name: /seats/i })).toBeNull()
})

test('a race that has only had one day of results says the score instead of drawing it', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    race: [{ personId: 'pn_a', date: '2026-05-02', wins: 3 }, { personId: 'pn_b', date: '2026-05-02', wins: 1 }],
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/AS out in front on 3 wins/)).toBeTruthy()
  expect(pane().queryByRole('img', { name: /wins/i })).toBeNull()
  // The caption cannot promise a line per person when there is no line.
  expect(pane().queryByText(/one line per person/)).toBeNull()
})

test('one day of betting is a number, not a single bar at full height', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: { daily: [{ date: '2026-05-01', bets: 4, staked: 30 }], biggest: null, lead: [] },
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/30 coins staked/)).toBeTruthy()
  expect(pane().queryByRole('img', { name: /bets/i })).toBeNull()
})

/* ---------------- the charts take the room a desktop gives them ---------------- */
// Height here is a viewBox ratio, not pixels: the drawing is stretched to whatever the
// card is wide. A 220-unit race across a 1400px pane is a flat line by accident.
const stubMedia = (matcher) => {
  const real = window.matchMedia
  window.matchMedia = (q) => ({
    matches: matcher(q), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })
  return () => { window.matchMedia = real }
}

test('a wide pane draws the race taller than a narrow one does', async () => {
  const restore = stubMedia((q) => q.includes('min-width:1280'))
  try {
    render(<Dashboard />)
    expect((await pane().findByRole('img', { name: /wins/i })).getAttribute('viewBox')).toBe('0 0 640 280')
  } finally { restore() }
})

test('a pane that is not wide keeps the race at the height it always was', async () => {
  const restore = stubMedia(() => false)
  try {
    render(<Dashboard />)
    expect((await pane().findByRole('img', { name: /wins/i })).getAttribute('viewBox')).toBe('0 0 640 220')
  } finally { restore() }
})
