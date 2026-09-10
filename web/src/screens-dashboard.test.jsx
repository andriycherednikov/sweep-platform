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
  expect(pane().getByText('4 picks · 1 wager')).toBeTruthy()
})

// The sweep app ranks people by their best club's table position for a league sweep
// (web/src/lib/assemble.js:249), so "out in front" here could name a different person
// from the one the group's own People tab calls leader. This chart measures team wins;
// the caption now says team wins.
test('the race caption names what it measures, not who is winning', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /wins/i })
  expect(pane().getByText(/AS has the most team wins — 3/)).toBeTruthy()
  expect(pane().queryByText(/out in front/)).toBeNull()
})

// Whoever the roster's name order put first was crowned, on the same number of wins as
// the person below them.
test('a tie at the top is called level, not won by whoever sorts first', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    race: [
      { personId: 'pn_a', date: '2026-05-01', wins: 1 },
      { personId: 'pn_a', date: '2026-05-02', wins: 2 },
      { personId: 'pn_b', date: '2026-05-01', wins: 3 },
    ],
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/AS, BT level on 3 wins/)).toBeTruthy()
})

// Both charts are drawn from tables with no history in them, and on a page whose whole
// job is entertainment a caption is cheaper than a schema change — but it has to be
// there, or the chart quietly claims to remember something it cannot.
test('the race admits it credits every win to whoever holds the team now', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /wins/i })
  expect(pane().getByText(/changes hands/i)).toBeTruthy()
})

// `calls` only carries the fixtures that have FINISHED with a result the feed named
// (api/src/routes/account.js), while the card beside it lists every pick anybody has
// made — so a group that has called all of next week's games was told nobody had called
// anything, next to the list of who had.
test('picks with nothing finished yet are not "nobody has called a game"', async () => {
  getAccountStats.mockResolvedValue([{ ...STATS, calls: [] }])
  render(<Dashboard />)
  expect(await pane().findByText(/4 picks in, and no result on any of them yet/)).toBeTruthy()
  expect(pane().queryByText(/Nobody has called a game/)).toBeNull()
})

test('a group that really has not picked anything still says so', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    calls: [],
    activity: [{ personId: 'pn_a', picks: 0, bets: 0 }, { personId: 'pn_b', picks: 0, bets: 0 }],
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/Nobody has called a game yet/)).toBeTruthy()
})

// The across axis is wins as a fraction of the group's best — Scatter takes 0..1 — so
// one hot person shoves everybody else to the left. Captioning it as an absolute count
// made every other dot read as "has won almost nothing".
test('the luck card captions the across axis as the relative thing it is', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /luck/i })
  expect(pane().getByText(/wins compare with the group's best/)).toBeTruthy()
  expect(pane().queryByText(/Across: how many games your teams have won/)).toBeNull()
})

test('the luck card admits the feed can rewrite what it divides by', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /luck/i })
  expect(pane().getByText(/drops the pick with it/i)).toBeTruthy()
})

// The state this page is opened in most often is the one before anything has kicked off:
// a sweep made this week, picks already in, not a win between them. Divided by the
// floor of 1 that mostWins used to carry, every dot then sits on the left wall under a
// caption promising somebody stood on the right-hand one.
test('nobody has won anything yet, so nobody is promised on the right-hand edge', async () => {
  getAccountStats.mockResolvedValue([{ ...STATS, race: [] }])
  render(<Dashboard />)
  await pane().findByRole('img', { name: /luck/i })
  expect(pane().queryByText(/right-hand edge/)).toBeNull()
  expect(pane().getByText(/left-hand wall/)).toBeTruthy()
})

// `wins` is every win in the sweep and the dots are only the people who have called a
// game, so the two sets are not the same one. Measured against a leader who never picks,
// the right-hand wall the caption points at has nobody on it at all.
test('the right-hand edge is somebody the chart actually draws', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    // Bo has three times Ann's wins and has never called a game, so he is not a dot.
    race: [
      { personId: 'pn_a', date: '2026-05-02', wins: 3 },
      { personId: 'pn_b', date: '2026-05-03', wins: 9 },
    ],
    calls: [{ personId: 'pn_a', picks: 4, right: 3 }],
  }])
  render(<Dashboard />)
  await pane().findByRole('img', { name: /luck/i })
  const dots = [...screen.getByRole('main').querySelectorAll('.ch-dot')]
  expect(dots.map((d) => d.textContent)).toEqual(['AS'])
  expect(dots[0].getAttribute('style')).toContain('calc(13px + 1 * (100% - 26px))')
})

// The other way round from the test above: the charts are the half that landed. The
// rail has nothing in it and no row can be ranked against a list that never arrived, so
// this is the path where every sweep falls back to the same place in the order.
test('the charts still draw when the sweep list is the half that fell over', async () => {
  getAccountSweeps.mockRejectedValue(new Error('boom'))
  getAccountStats.mockResolvedValue([STATS, { ...STATS, sweepId: 'sw2' }])
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

test('wagering on draws the wagers, the biggest win and who leaves it latest', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: {
      daily: [{ date: '2026-05-01', bets: 2, staked: 15 }, { date: '2026-05-02', bets: 1, staked: 5 }],
      biggest: { personId: 'pn_a', profit: 40 },
      lead: [{ personId: 'pn_a', medianSec: 2460 }],
    },
  }])
  render(<Dashboard />)
  expect(await pane().findByRole('img', { name: /wagers/i })).toBeTruthy()
  expect(pane().getByText(/40/)).toBeTruthy()
  expect(pane().getByText(/41 minutes/)).toBeTruthy()
})

// A bet needs its fixture to still be `upcoming` (api/src/routes/coins.js:70), so a
// negative lead time is not an in-play punt — it is a kickoff that had already passed:
// a fixture the feed had not moved on yet, or one rescheduled earlier after the bet. It
// rendered as "a median -14 minutes before kickoff", and since the line picks the
// smallest lead time a negative one always won it.
test('a bet placed after the kickoff time is not "-14 minutes before kickoff"', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: {
      daily: [{ date: '2026-05-01', bets: 2, staked: 15 }, { date: '2026-05-02', bets: 1, staked: 5 }],
      biggest: null,
      lead: [{ personId: 'pn_a', medianSec: -840 }],
    },
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/14 minutes past the kickoff time/)).toBeTruthy()
  expect(pane().queryByText(/-14/)).toBeNull()
})

// The api's `wagers` union exists precisely so a four-leg accumulator counts as the one
// row it is, so the fattest win on the board can be a parlay.
test('the biggest win is on one wager, which a parlay also is', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: {
      daily: [{ date: '2026-05-01', bets: 1, staked: 1 }],
      biggest: { personId: 'pn_a', profit: 40 },
      lead: [],
    },
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/40 coins up on one wager/)).toBeTruthy()
  // And the commonest single-item case reads as English. The count itself is the big
  // number beside this span, which is why the match starts mid-sentence.
  expect(pane().getByText(/wager · 1 coin staked/)).toBeTruthy()
})

// Same lie, drawn as bars: two busy days a week apart are two bars side by side unless
// the quiet days in between are in the array.
test('the wagers-per-day bars keep a slot for the days nobody had one on', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: {
      daily: [{ date: '2026-05-01', bets: 2, staked: 15 }, { date: '2026-05-04', bets: 1, staked: 5 }],
      biggest: null,
      lead: [],
    },
  }])
  const { container } = render(<Dashboard />)
  await pane().findByRole('img', { name: /wagers/i })
  expect(container.querySelectorAll('.ac-grid rect')).toHaveLength(4)
  expect(pane().getByText(/3 wagers · 20 coins staked/)).toBeTruthy()
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
      ...STATS, sweepId: 'sw2', race: [],
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

// person.created_at is when the OWNER typed a name into the roster; nothing records
// when a link was actually sent. And "1 seat still haven't been claimed" fired on the
// commonest case there is.
test('the joins caption says what it measured, in English', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /seats invited/i })
  expect(pane().getByText(/1 seat still hasn't been claimed/)).toBeTruthy()
  expect(pane().getByText(/last seat added \d+ days ago/)).toBeTruthy()
  expect(pane().queryByText(/last invite went out/)).toBeNull()
})

test('a seat added today was not added 0 days ago', async () => {
  const today = new Date().toISOString().slice(0, 10)
  getAccountStats.mockResolvedValue([{
    ...STATS,
    joins: [{ date: '2026-05-01', created: 1, claimed: 1 }, { date: today, created: 1, claimed: 0 }],
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/last seat added today/)).toBeTruthy()
})

// `next` is the soonest kickoff STILL AHEAD, so it goes null on a stalled feed and on
// fixtures with no date on them too — and the card announced the season was over while
// the bar above it said a third of the games were unplayed.
test('no kickoff ahead is not the same as no games left', async () => {
  getAccountStats.mockResolvedValue([{ ...STATS, season: { final: 3, total: 5, next: null } }])
  render(<Dashboard />)
  expect(await pane().findByText(/2 games still to play/)).toBeTruthy()
  expect(pane().queryByText(/Nothing left on the calendar/)).toBeNull()
})

test('a season that really is over says so', async () => {
  getAccountStats.mockResolvedValue([{ ...STATS, season: { final: 5, total: 5, next: null } }])
  render(<Dashboard />)
  expect(await pane().findByText(/Nothing left on the calendar/)).toBeTruthy()
})

// The roster rows carry no account id, so the same friend in three of your sweeps is
// three rows here and there is nothing to de-duplicate them by. Count seats, say seats.
test('the header counts seats, because seats are what the payload has', async () => {
  render(<Dashboard />)
  await pane().findByRole('img', { name: /wins/i })
  expect(pane().getByText(/1 sweep running · 2 seats in them/)).toBeTruthy()
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
  expect(await pane().findByText(/AS has the most team wins — 3/)).toBeTruthy()
  expect(pane().queryByRole('img', { name: /wins/i })).toBeNull()
  // The caption cannot promise a line per person when there is no line.
  expect(pane().queryByText(/one line per person/)).toBeNull()
})

// The big number stands where a chart of EVERY line would be, and the two cards doing
// the same trick beside it — seats claimed, wagers placed — both put the group's total in
// it. This one put the leader's, so a sweep with four wins in it announced three.
test("the one-day race number is the group's wins, not the leader's", async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    race: [{ personId: 'pn_a', date: '2026-05-02', wins: 3 }, { personId: 'pn_b', date: '2026-05-02', wins: 1 }],
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/AS has the most team wins — 3/)).toBeTruthy()
  const big = screen.getByRole('main').querySelector('.ch-big')
  expect(big.childNodes[0].textContent).toBe('4')
  expect(big.querySelector('span').textContent).toBe('wins so far, all on the one day')
})

test('one day of betting is a number, not a single bar at full height', async () => {
  getAccountStats.mockResolvedValue([{
    ...STATS,
    wagering: { daily: [{ date: '2026-05-01', bets: 4, staked: 30 }], biggest: null, lead: [] },
  }])
  render(<Dashboard />)
  expect(await pane().findByText(/30 coins staked/)).toBeTruthy()
  expect(pane().queryByRole('img', { name: /wagers/i })).toBeNull()
})

/* ---------------- the charts take the room a desktop gives them ---------------- */
// Nothing left to assert here: how tall a chart is comes from the stylesheet (.ch-box)
// and how many columns the grid runs comes from a container query, neither of which
// jsdom computes and neither of which this file could check without asserting a class
// name and calling it verification. Both are measured in a real browser instead.
