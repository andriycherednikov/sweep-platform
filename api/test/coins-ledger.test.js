import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { event, person, coinLedger, bet, sweep, competition, competitor } from '../src/db/schema.js'
import { seasonAnchor, currentWeekIndex, ensureGrants, balanceOf, statementFor } from '../src/coins/ledger.js'
import { WEEK_MS } from '../src/coins/constants.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

test('seasonAnchor is the earliest fixture kickoff', async () => {
  const anchor = await seasonAnchor(db, 'apifootball:1:2026')
  const [{ ko }] = await db.select({ ko: event.startUtc }).from(event).orderBy(event.startUtc).limit(1)
  expect(anchor.getTime()).toBe(new Date(ko).getTime())
})

test('ensureGrants credits the starting bankroll once, idempotently', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db, 'apifootball:1:2026')
  const justAfterStart = new Date(anchor.getTime() + 1000)
  await ensureGrants(db, 'default', p.id, justAfterStart)
  await ensureGrants(db, 'default', p.id, justAfterStart) // re-run is a no-op
  const rows = await db.select().from(coinLedger).where(eq(coinLedger.personId, p.id))
  expect(rows.filter((r) => r.type === 'grant')).toHaveLength(1)
  expect(await balanceOf(db, 'default', p.id)).toBe(1000)
})

test('ensureGrants backfills one grant per elapsed week', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db, 'apifootball:1:2026')
  const threeWeeksIn = new Date(anchor.getTime() + 3 * WEEK_MS + 1000)
  await ensureGrants(db, 'default', p.id, threeWeeksIn)
  expect(await balanceOf(db, 'default', p.id)).toBe(4000) // weeks 0,1,2,3
  expect(currentWeekIndex(anchor, threeWeeksIn)).toBe(3)
})

test('balanceOf is zero for a person with no ledger rows', async () => {
  const p = await aPerson()
  expect(await balanceOf(db, 'default', p.id)).toBe(0)
})

// Guard: with no fixtures, min(kickoff) is null → seasonAnchor must NOT become the Unix epoch
// (which would make currentWeekIndex ~2900 and ensureGrants loop thousands of times).
test('seasonAnchor is null and ensureGrants is a no-op when there are no fixtures', async () => {
  // one mock row serves both queries: the sweep lookup reads .competitionId, the anchor reads .min
  const emptyDb = {
    select: () => ({ from: () => ({ where: async () => [{ competitionId: 'apifootball:1:2026', min: null }] }) }),
    insert: () => { throw new Error('ensureGrants must not insert without a season anchor') },
  }
  expect(await seasonAnchor(emptyDb, 'apifootball:1:2026')).toBeNull()
  await expect(ensureGrants(emptyDb, 'default', 'pn_x', new Date())).resolves.toBeUndefined()
})

// GATE(phase-2): an unscoped min(startUtc) lets a second competition with an earlier
// season shift every sweep's week index and mint retroactive grants.
test('seasonAnchor is scoped to one competition; grants ignore other competitions', async () => {
  const [{ ko }] = await db.select({ ko: event.startUtc }).from(event).orderBy(event.startUtc).limit(1)
  const early = new Date(new Date(ko).getTime() - 10 * WEEK_MS)
  await db.insert(competition).values({ id: 'test:b:1', provider: 'test', sport: 'basketball', leagueId: 'b', season: '1', format: 'league', name: 'B' })
  await db.insert(competitor).values([
    { id: 'cpB_aaa', competitionId: 'test:b:1', code: 'aaa', name: 'Aaa', color: '#000' },
    { id: 'cpB_bbb', competitionId: 'test:b:1', code: 'bbb', name: 'Bbb', color: '#111' },
  ])
  await db.insert(event).values({ id: 'evB_1', competitionId: 'test:b:1', c1Code: 'aaa', c2Code: 'bbb', startUtc: early, status: 'final', stage: 'group' })
  try {
    const anchor = await seasonAnchor(db, 'apifootball:1:2026')
    expect(anchor.getTime()).toBe(new Date(ko).getTime())
    expect((await seasonAnchor(db, 'test:b:1')).getTime()).toBe(early.getTime())
    // default sweep is bound to apifootball:1:2026 → just after ITS start = week 0 only, not week 10
    const p = await aPerson()
    await ensureGrants(db, 'default', p.id, new Date(new Date(ko).getTime() + 1000))
    const rows = await db.select().from(coinLedger).where(eq(coinLedger.personId, p.id))
    expect(rows.filter((r) => r.type === 'grant')).toHaveLength(1)
  } finally {
    await db.delete(event).where(eq(event.id, 'evB_1'))
    await db.delete(competitor).where(eq(competitor.competitionId, 'test:b:1'))
    await db.delete(competition).where(eq(competition.id, 'test:b:1'))
  }
})

// --- statementFor ---------------------------------------------------------

test('statementFor returns grants newest-first with weekIndex and a running balance', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db, 'apifootball:1:2026')
  const twoWeeksIn = new Date(anchor.getTime() + 2 * WEEK_MS + 1000)
  await ensureGrants(db, 'default', p.id, twoWeeksIn) // weeks 0,1,2 → 3000 total

  const { balance, entries } = await statementFor(db, 'default', p.id, twoWeeksIn)
  expect(balance).toBe(3000)
  expect(entries).toHaveLength(3)
  // newest first: week 2 grant on top, running balance is the final cumulative
  expect(entries[0]).toMatchObject({ type: 'grant', amount: 1000, weekIndex: 2, balanceAfter: 3000, bet: null })
  expect(entries[1]).toMatchObject({ type: 'grant', weekIndex: 1, balanceAfter: 2000 })
  expect(entries[2]).toMatchObject({ type: 'grant', weekIndex: 0, balanceAfter: 1000 })
})

test('statementFor attaches the matching bet to stake and payout rows', async () => {
  const p = await aPerson()
  const [f] = await db.select().from(event).limit(1)
  const anchor = await seasonAnchor(db, 'apifootball:1:2026')
  const wk0 = new Date(anchor.getTime() + 1000)
  await ensureGrants(db, 'default', p.id, wk0) // pin a single week-0 grant (+1000), date-independent
  // a won bet: stake -100, payout +230
  await db.insert(bet).values({ id: 'bet1', sweepId: 'default', personId: p.id, fixtureId: f.id,
    market: '1x2', selection: 'HOME', stake: 100, oddsDecimal: '2.3', book: 'Pinnacle',
    potentialPayout: 230, status: 'won' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -100, refId: 'bet1' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'payout', amount: 230, refId: 'bet1' })

  const { balance, entries } = await statementFor(db, 'default', p.id, wk0)
  expect(balance).toBe(1130) // 1000 - 100 + 230
  const payout = entries.find((e) => e.type === 'payout')
  const stake = entries.find((e) => e.type === 'stake')
  expect(payout.bet).toMatchObject({ id: 'bet1', market: '1x2', selection: 'HOME', status: 'won', stake: 100 })
  expect(stake.bet).toMatchObject({ id: 'bet1', selection: 'HOME', status: 'won' })
  expect(stake.amount).toBe(-100)
})

test('statementFor leaves a lost bet as a lone stake row (no payout) carrying status lost', async () => {
  const p = await aPerson()
  const [f] = await db.select().from(event).limit(1)
  const anchor = await seasonAnchor(db, 'apifootball:1:2026')
  const wk0 = new Date(anchor.getTime() + 1000)
  await ensureGrants(db, 'default', p.id, wk0) // pin a single week-0 grant (+1000), date-independent
  await db.insert(bet).values({ id: 'bet2', sweepId: 'default', personId: p.id, fixtureId: f.id,
    market: '1x2', selection: 'AWAY', stake: 200, oddsDecimal: '3', book: null,
    potentialPayout: 600, status: 'lost' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -200, refId: 'bet2' })

  const { balance, entries } = await statementFor(db, 'default', p.id, wk0)
  expect(balance).toBe(800)
  expect(entries.filter((e) => e.type === 'payout')).toHaveLength(0)
  const stake = entries.find((e) => e.type === 'stake')
  expect(stake.bet).toMatchObject({ status: 'lost', selection: 'AWAY' })
})

test('statementFor sets bet=null when the ledger row references a pruned bet', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -50, refId: 'gone' })
  const { entries } = await statementFor(db, 'default', p.id)
  const stake = entries.find((e) => e.type === 'stake')
  expect(stake.bet).toBeNull()
})

test('statementFor surfaces fixtureId (and bet:null) for predict/teamwin reward rows', async () => {
  const p = await aPerson()
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'predict', amount: 100, refId: 'fix_42' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'teamwin', amount: 300, refId: 'fix_42' })
  const { entries } = await statementFor(db, 'default', p.id)
  const predict = entries.find((e) => e.type === 'predict')
  const teamwin = entries.find((e) => e.type === 'teamwin')
  expect(predict).toMatchObject({ amount: 100, fixtureId: 'fix_42', bet: null, weekIndex: null })
  expect(teamwin).toMatchObject({ amount: 300, fixtureId: 'fix_42', bet: null, weekIndex: null })
})

test('statementFor is isolated per sweep', async () => {
  const p = await aPerson()
  // a parallel sweep with its own person — the composite FK requires both to exist
  await db.insert(sweep).values({ id: 'other', name: 'Other', competitionId: 'apifootball:1:2026' }).onConflictDoNothing()
  await db.insert(person).values({ id: 'pn_other', sweepId: 'other', name: 'Other', short: 'Oth', initials: 'OT', avColor: '#999' }).onConflictDoNothing()
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'grant', amount: 1000, refId: '0' })
  await db.insert(coinLedger).values({ sweepId: 'other', personId: 'pn_other', type: 'grant', amount: 9999, refId: '0' })
  const { entries } = await statementFor(db, 'default', p.id)
  expect(entries.every((e) => e.amount !== 9999)).toBe(true)
  // clean up the parallel sweep so it can't leak into aPerson()/other tests
  await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'other'))
  await db.delete(person).where(eq(person.sweepId, 'other'))
  await db.delete(sweep).where(eq(sweep.id, 'other'))
})
