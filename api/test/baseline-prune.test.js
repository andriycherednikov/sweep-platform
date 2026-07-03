import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq, and } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { event, person, coinLedger, bet, parlay, support, competition, sweep, competitor, ranking } from '../src/db/schema.js'
import { refundPrunedParlays, syncBaseline } from '../src/worker/baseline-sync.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { seed } from '../src/seed/seed.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()
const COMPETITION_ID = 'apifootball:1:2026' // the seeded (Phase-1) competition
const FOOTBALL_COMP = { id: 'apifootball:1:2026', provider: 'apifootball', sport: 'football', leagueId: '1', season: '2026' }
beforeAll(async () => {
  // wire crosswalk: hr→3001, be→3002, gh→3003 (matches recorded JSON) — same as baseline-sync.test.js
  await db.update(competitor).set({ providerId: 3001 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'hr')))
  await db.update(competitor).set({ providerId: 3002 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'be')))
  await db.update(competitor).set({ providerId: 3003 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'gh')))
})
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger) })

test('refundPrunedParlays refunds + deletes a parlay with a leg on a dropped fixture', async () => {
  const p = (await db.select().from(person).limit(1))[0]
  await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(event).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -100, refId: 'par_p' })
  await db.insert(parlay).values({ id: 'par_p', sweepId: 'default', personId: p.id, stake: 100, combinedOdds: '4', potentialPayout: 400, status: 'open' })
  await db.insert(bet).values({ id: 'lg1', sweepId: 'default', personId: p.id, fixtureId: f1.id, parlayId: 'par_p', selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })
  await db.insert(bet).values({ id: 'lg2', sweepId: 'default', personId: p.id, fixtureId: f2.id, parlayId: 'par_p', selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })
  // keep only f2 → f1's leg is dropped → refund whole parlay; scope = this competition's events
  const compEventIds = db.select({ id: event.id }).from(event).where(eq(event.competitionId, COMPETITION_ID))
  await refundPrunedParlays(db, [f2.id], compEventIds)
  expect(await db.select().from(parlay).where(eq(parlay.id, 'par_p'))).toHaveLength(0) // deleted (cascade legs)
  expect(await db.select().from(bet).where(eq(bet.parlayId, 'par_p'))).toHaveLength(0)
  expect(await balanceOf(db, 'default', p.id)).toBe(start) // stake refunded
})

// GATE(phase-2): an omitted scope used to mean "global" — one competition's baseline
// could refund-and-delete every other competition's parlays. Scope is now required.
test('refundPrunedParlays throws when the competition scope is omitted', async () => {
  await expect(refundPrunedParlays(db, ['whatever'])).rejects.toThrow(/scope/)
})

test('syncing one competition never prunes another competition\'s dependent rows', async () => {
  const COMPETITION_2 = 'apifootball:2:2099'
  await db.insert(competition).values({
    id: COMPETITION_2, provider: 'apifootball', sport: 'football', leagueId: '2', season: '2099',
    format: 'league', name: 'Other Competition',
  }).onConflictDoNothing()
  await db.insert(sweep).values({
    id: 'sweep_c2', name: 'Other Sweep', kind: 'default', scoringRule: 'top3', coOwners: 'all_win', competitionId: COMPETITION_2,
  }).onConflictDoNothing()
  await db.insert(person).values({
    id: 'person_c2', sweepId: 'sweep_c2', name: 'Other Person', short: 'Other', initials: 'OP', avColor: '#123456',
  }).onConflictDoNothing()
  await db.insert(competitor).values([
    { id: `cp_${COMPETITION_2}_aa`, competitionId: COMPETITION_2, code: 'aa', name: 'Team AA', color: '#111111' },
    { id: `cp_${COMPETITION_2}_bb`, competitionId: COMPETITION_2, code: 'bb', name: 'Team BB', color: '#222222' },
  ]).onConflictDoNothing()
  await db.insert(event).values({
    id: 'ev_c2_1', competitionId: COMPETITION_2, c1Code: 'aa', c2Code: 'bb',
    startUtc: new Date(), status: 'upcoming', detail: {},
  }).onConflictDoNothing()
  await db.insert(support).values({ sweepId: 'sweep_c2', fixtureId: 'ev_c2_1', personId: 'person_c2', teamCode: 'aa' }).onConflictDoNothing()
  await db.insert(bet).values({
    id: 'bet_c2_1', sweepId: 'sweep_c2', personId: 'person_c2', fixtureId: 'ev_c2_1',
    selection: 'HOME', market: '1x2', stake: 100, oddsDecimal: '2', potentialPayout: 200, status: 'open',
  })
  await db.insert(coinLedger).values({ sweepId: 'sweep_c2', personId: 'person_c2', type: 'stake', amount: -100, refId: 'bet_c2_1' })
  await db.insert(parlay).values({ id: 'parlay_c2_1', sweepId: 'sweep_c2', personId: 'person_c2', stake: 50, combinedOdds: '4', potentialPayout: 200, status: 'open' })
  await db.insert(bet).values({
    id: 'leg_c2_1', sweepId: 'sweep_c2', personId: 'person_c2', fixtureId: 'ev_c2_1', parlayId: 'parlay_c2_1',
    selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open',
  })

  try {
    // baseline for the FIRST competition prunes its fixtures down to the provider set —
    // competition 2's event/support/bet/ledger/parlay must all survive untouched.
    const provider = createRecordedProvider({ fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams') })
    const r = await syncBaseline(db, provider, FOOTBALL_COMP)
    expect(r.newlyFinal).toEqual(expect.any(Array))

    expect(await db.select().from(event).where(eq(event.id, 'ev_c2_1'))).toHaveLength(1)
    expect(await db.select().from(support).where(eq(support.fixtureId, 'ev_c2_1'))).toHaveLength(1)
    expect(await db.select().from(bet).where(eq(bet.id, 'bet_c2_1'))).toHaveLength(1)
    expect(await db.select().from(coinLedger).where(eq(coinLedger.refId, 'bet_c2_1'))).toHaveLength(1)
    expect(await db.select().from(parlay).where(eq(parlay.id, 'parlay_c2_1'))).toHaveLength(1)
    expect(await db.select().from(bet).where(eq(bet.id, 'leg_c2_1'))).toHaveLength(1)
  } finally {
    // teardown competition 2's rows + restore competition 1's Phase-1 seed so later test
    // files (which depend on the global seed) still pass.
    await db.delete(bet).where(eq(bet.sweepId, 'sweep_c2'))
    await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'sweep_c2'))
    await db.delete(parlay).where(eq(parlay.sweepId, 'sweep_c2'))
    await db.delete(support).where(eq(support.sweepId, 'sweep_c2'))
    await db.delete(event).where(eq(event.competitionId, COMPETITION_2))
    await db.delete(person).where(eq(person.id, 'person_c2'))
    await db.delete(competitor).where(eq(competitor.competitionId, COMPETITION_2))
    await db.delete(sweep).where(eq(sweep.id, 'sweep_c2'))
    await db.delete(competition).where(eq(competition.id, COMPETITION_2))
    await db.delete(event).where(eq(event.competitionId, COMPETITION_ID))
    await db.delete(ranking).where(eq(ranking.competitionId, COMPETITION_ID))
    await seed(db)
  }
})
