import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import {
  account, accountSession, bet, competition, competitor, event, ownership, parlay, person, photo, support, sweep,
} from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })

const COMP = 'teststats:9:2099'
const SW = 'sw_stats'          // wagering on, three seats, one of them ejected
const PLAIN = 'sw_stats_plain' // wagering off, nobody in it — the empty half of every block
// One fixed day for every seat and every bet, so the daily buckets are assertable.
const DAY = new Date('2024-05-01T12:00:00Z')
const EV1 = new Date('2024-05-02T18:00:00Z') // final, NO winner_code — decided on score
const EV2 = new Date('2024-05-03T18:00:00Z') // final, winner_code set
const EV4 = new Date('2024-05-04T18:00:00Z') // final, level score → a draw
const POSTPONED = new Date('2024-04-01T18:00:00Z') // still 'upcoming', but long past
const NEXT = new Date(Date.now() + 7 * 24 * 3600_000)

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values([
    { id: 'ac_stats', email: 'stats@example.test', subscriptionStatus: 'active' },
    { id: 'ac_stats_gone', email: 'statsgone@example.test' },
    { id: 'ac_stats_none', email: 'statsnone@example.test' },
  ]).onConflictDoNothing()
  await db.insert(competition).values({
    id: COMP, provider: 'teststats', sport: 'basketball', leagueId: '9', season: '2099',
    format: 'league', name: 'Stats League',
  }).onConflictDoNothing()
  await db.insert(competitor).values([
    { id: 'cp_stats_a', competitionId: COMP, code: 'AAA', name: 'Alphas', color: '#111111' },
    { id: 'cp_stats_b', competitionId: COMP, code: 'BBB', name: 'Betas', color: '#222222' },
    { id: 'cp_stats_c', competitionId: COMP, code: 'CCC', name: 'Gammas', color: '#333333' },
  ]).onConflictDoNothing()
  await db.insert(event).values([
    { id: 'ev_s1', competitionId: COMP, c1Code: 'AAA', c2Code: 'BBB', startUtc: EV1, status: 'final', score1: 2, score2: 1, winnerCode: null },
    { id: 'ev_s2', competitionId: COMP, c1Code: 'CCC', c2Code: 'BBB', startUtc: EV2, status: 'final', score1: 1, score2: 0, winnerCode: 'CCC' },
    { id: 'ev_s3', competitionId: COMP, c1Code: 'AAA', c2Code: 'CCC', startUtc: NEXT, status: 'upcoming' },
    { id: 'ev_s4', competitionId: COMP, c1Code: 'BBB', c2Code: 'CCC', startUtc: EV4, status: 'final', score1: 1, score2: 1, winnerCode: null },
    { id: 'ev_s5', competitionId: COMP, c1Code: 'AAA', c2Code: 'BBB', startUtc: POSTPONED, status: 'upcoming' },
  ]).onConflictDoNothing()
  await db.insert(sweep).values([
    { id: SW, name: 'Stats', kind: 'token', memberToken: 'statsmembertoken00000', competitionId: COMP, accountId: 'ac_stats', wageringEnabled: true },
    { id: PLAIN, name: 'Plain', kind: 'token', memberToken: 'plainmembertoken00000', competitionId: COMP, accountId: 'ac_stats', wageringEnabled: false },
  ]).onConflictDoNothing()
  await db.insert(person).values([
    { id: 'pn_ann', sweepId: SW, name: 'Ann', short: 'Ann', initials: 'AN', avColor: '#e11', accountId: 'ac_stats', createdAt: DAY, claimedAt: DAY },
    { id: 'pn_bob', sweepId: SW, name: 'Bob', short: 'Bob', initials: 'BO', avColor: '#22e', createdAt: DAY },
    { id: 'pn_eve', sweepId: SW, name: 'Eve', short: 'Eve', initials: 'EV', avColor: '#2e2', accountId: 'ac_stats_gone', createdAt: DAY, claimedAt: DAY, ejectedAt: new Date() },
  ]).onConflictDoNothing()
  await db.insert(ownership).values([
    { sweepId: SW, personId: 'pn_ann', competitorId: 'cp_stats_a' },
    { sweepId: SW, personId: 'pn_bob', competitorId: 'cp_stats_b' },
    { sweepId: SW, personId: 'pn_eve', competitorId: 'cp_stats_c' },
  ]).onConflictDoNothing()
  await db.insert(support).values([
    { sweepId: SW, personId: 'pn_ann', fixtureId: 'ev_s1', teamCode: 'AAA' }, // right (on the score)
    { sweepId: SW, personId: 'pn_ann', fixtureId: 'ev_s2', teamCode: 'BBB' }, // wrong
    { sweepId: SW, personId: 'pn_bob', fixtureId: 'ev_s4', teamCode: 'DRAW' }, // right
    { sweepId: SW, personId: 'pn_eve', fixtureId: 'ev_s1', teamCode: 'AAA' }, // ejected — nowhere
  ]).onConflictDoNothing()
  await db.insert(bet).values([
    { id: 'bt_s1', sweepId: SW, personId: 'pn_ann', fixtureId: 'ev_s1', selection: 'HOME', stake: 10, oddsDecimal: '2.5', potentialPayout: 25, status: 'won', placedAt: DAY },
    { id: 'bt_s2', sweepId: SW, personId: 'pn_bob', fixtureId: 'ev_s2', selection: 'AWAY', stake: 5, oddsDecimal: '2.4', potentialPayout: 12, status: 'lost', placedAt: DAY },
    // The fattest win in the sweep belongs to somebody who is not in it any more.
    { id: 'bt_s3', sweepId: SW, personId: 'pn_eve', fixtureId: 'ev_s1', selection: 'HOME', stake: 100, oddsDecimal: '9', potentialPayout: 900, status: 'won', placedAt: DAY },
  ]).onConflictDoNothing()
  // Bob's accumulator, written the way POST /api/parlay writes one: the stake and the
  // payout are on the parlay row, and the legs below carry zeroes.
  await db.insert(parlay).values({
    id: 'par_s1', sweepId: SW, personId: 'pn_bob', stake: 20, combinedOdds: '5', potentialPayout: 100, status: 'won', placedAt: DAY,
  }).onConflictDoNothing()
  await db.insert(bet).values([
    { id: 'bt_s4', sweepId: SW, personId: 'pn_bob', fixtureId: 'ev_s1', parlayId: 'par_s1', selection: 'HOME', stake: 0, oddsDecimal: '2.5', potentialPayout: 0, status: 'won', placedAt: DAY },
    { id: 'bt_s5', sweepId: SW, personId: 'pn_bob', fixtureId: 'ev_s2', parlayId: 'par_s1', selection: 'HOME', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'won', placedAt: DAY },
  ]).onConflictDoNothing()
  // Both shapes the photos route writes: a fan photo (the upload people actually make)
  // carries NO person, and an avatar carries one. Counting per person could only ever
  // see the avatar, which is why the dashboard no longer claims a photo count at all.
  await db.insert(photo).values([
    { id: 'ph_s1', sweepId: SW, kind: 'fan', uploaderName: 'Bob', personId: null, fixtureId: 'ev_s1', filePath: 'a.jpg' },
    { id: 'ph_s2', sweepId: SW, kind: 'profile', uploaderName: 'Bob', personId: 'pn_bob', filePath: 'b.jpg' },
  ]).onConflictDoNothing()
})

afterAll(async () => {
  for (const id of [SW, PLAIN]) {
    await db.delete(photo).where(eq(photo.sweepId, id))
    await db.delete(bet).where(eq(bet.sweepId, id))
    await db.delete(parlay).where(eq(parlay.sweepId, id))
    await db.delete(support).where(eq(support.sweepId, id))
    await db.delete(ownership).where(eq(ownership.sweepId, id))
    await db.delete(person).where(eq(person.sweepId, id))
    await db.delete(sweep).where(eq(sweep.id, id))
  }
  await db.delete(event).where(eq(event.competitionId, COMP))
  await db.delete(competitor).where(eq(competitor.competitionId, COMP))
  await db.delete(competition).where(eq(competition.id, COMP))
  for (const id of ['ac_stats', 'ac_stats_gone', 'ac_stats_none']) {
    await db.delete(accountSession).where(eq(accountSession.accountId, id))
    await db.delete(account).where(eq(account.id, id))
  }
  await app.close(); await pool.end()
})

const statsFor = async (accountId) => {
  const res = await app.inject({ method: 'GET', url: '/api/account/stats', headers: await ownerHeaders(db, accountId) })
  expect(res.statusCode).toBe(200)
  return res
}
const forSweep = async (id) => (await statsFor('ac_stats')).json().find((s) => s.sweepId === id)

test('a dashboard left open is not eleven queries a minute', async () => {
  const res = await statsFor('ac_stats')
  expect(res.headers['cache-control']).toBe('private, max-age=60')
})

test('an account that owns nothing gets an empty list', async () => {
  expect((await statsFor('ac_stats_none')).json()).toEqual([])
})

test('the charts get the roster they label their lines with', async () => {
  const s = await forSweep(SW)
  expect(s.people.map((p) => p.id).sort()).toEqual(['pn_ann', 'pn_bob'])
  expect(s.people.find((p) => p.id === 'pn_ann')).toMatchObject({ name: 'Ann', initials: 'AN', avColor: '#e11' })
  expect(s.people.find((p) => p.id === 'pn_bob').claimedAt).toBe(null)
})

test('the gap between seats made and seats claimed is the "not joined yet" number, drawn', async () => {
  const s = await forSweep(SW)
  expect(s.joins).toEqual([{ date: '2024-05-01', created: 2, claimed: 1 }])
})

// The whole reason the winner is not a bare winner_code: the feed leaves it null whenever
// the provider names no winning side, and the sweep's own Wins tab reads the score
// instead. A console chart that skipped ev_s1 would contradict the leaderboard beside it.
test('the race counts a final with no winner_code, decided on the score', async () => {
  const s = await forSweep(SW)
  expect(s.race).toEqual([{ personId: 'pn_ann', date: '2024-05-02', wins: 1 }])
})

test('a level final is a draw, and belongs to nobody', async () => {
  const s = await forSweep(SW)
  expect(s.race.some((r) => r.date === '2024-05-04')).toBe(false)
})

// Filtering on status alone renders a fixture that was postponed months ago as "Next".
test('the next kickoff is the upcoming one, not the postponed one', async () => {
  const s = await forSweep(SW)
  expect(s.season).toEqual({ final: 3, total: 5, next: NEXT.toISOString() })
})

test('calls score a pick against the same winner the race uses, draws included', async () => {
  const s = await forSweep(SW)
  expect(s.calls.find((c) => c.personId === 'pn_ann')).toEqual({ personId: 'pn_ann', picks: 2, right: 1 })
  expect(s.calls.find((c) => c.personId === 'pn_bob')).toEqual({ personId: 'pn_bob', picks: 1, right: 1 })
})

test('the loud-and-quiet list keeps the quiet ones, at zero', async () => {
  const s = await forSweep(SW)
  // Bob has both a fan photo and an avatar in this sweep, and neither is a number here:
  // a per-person photo count cannot be sourced, so nothing pretends to be one.
  expect(Object.keys(s.activity[0])).toEqual(['personId', 'picks', 'bets'])
  expect(s.activity).toEqual([
    { personId: 'pn_ann', picks: 2, bets: 1 },
    // Two, not three: Bob placed one single and one two-leg parlay.
    { personId: 'pn_bob', picks: 1, bets: 2 },
  ])
})

// A parlay leg is a bet row with stake 0 and payout 0, so a route that reads the bet table
// alone prints three bets that staked 15 and cannot see the 100 the accumulator paid.
test('wagering counts what was staked, and whose win was fattest', async () => {
  const s = await forSweep(SW)
  // Three wagers, not five: two singles and ONE parlay, staking 10 + 5 + 20.
  expect(s.wagering.daily).toEqual([{ date: '2024-05-01', bets: 3, staked: 35 }])
  // Eve's 800 is the biggest number in the table and she is not in the sweep any more.
  expect(s.wagering.biggest).toEqual({ personId: 'pn_bob', profit: 80 })
  // A parlay's lead time runs to its EARLIEST leg (ev_s1, 30h out), so Bob's two wagers
  // are 54h and 30h — and the median of a union is not the average of two medians.
  expect(s.wagering.lead).toEqual([
    { personId: 'pn_ann', medianSec: 30 * 3600 },
    { personId: 'pn_bob', medianSec: 42 * 3600 },
  ])
})

test('an ejected seat is in none of it', async () => {
  const s = await forSweep(SW)
  const everyone = JSON.stringify(s)
  expect(everyone).not.toContain('pn_eve')
})

test('a sweep with wagering off carries no wagering block', async () => {
  const s = await forSweep(PLAIN)
  expect(s.wagering).toBeUndefined()
  // Empty, not missing: an empty sweep still renders, it just renders nothing.
  expect(s).toMatchObject({ people: [], joins: [], race: [], calls: [], activity: [] })
  expect(s.season).toEqual({ final: 3, total: 5, next: NEXT.toISOString() })
})

// Two sweeps on one competition get the identical season block, because it is grouped by
// competition. The client sums across sweeps, so it needs to know which of them share one.
test('every row names the competition it follows, so the client can dedupe the season', async () => {
  const all = (await statsFor('ac_stats')).json()
  expect(all.map((s) => s.competitionId)).toEqual([COMP, COMP])
})
