import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet, parlay } from '../src/db/schema.js'
import { settleBets, settleParlay, settleStaleBets } from '../src/coins/settle.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

async function makeParlay(p, id, stake, combinedOdds, legs) {
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -stake, refId: id })
  await db.insert(parlay).values({ id, sweepId: 'default', personId: p.id, stake, combinedOdds: String(combinedOdds), potentialPayout: Math.round(stake * combinedOdds), status: 'open' })
  for (const [i, l] of legs.entries()) {
    await db.insert(bet).values({ id: `${id}_leg${i}`, sweepId: 'default', personId: p.id, fixtureId: l.fixtureId, parlayId: id,
      market: l.market ?? '1x2', selection: l.selection, line: l.line == null ? null : String(l.line), stake: 0, oddsDecimal: String(l.odds), potentialPayout: 0, status: 'open' })
  }
}

test('a parlay loses the moment any leg loses', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_lose', 100, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(fixture).set({ status: 'final', regScore1: 0, regScore2: 1 }).where(eq(fixture.id, f1.id))
  await settleBets(db, f1.id)
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_lose')))[0].status).toBe('lost')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100)
})

test('a parlay stays open until the last leg, then pays when all legs win', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_win', 100, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f1.id))
  await settleBets(db, f1.id)
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_win')))[0].status).toBe('open')
  await db.update(fixture).set({ status: 'final', regScore1: 2, regScore2: 1 }).where(eq(fixture.id, f2.id))
  const published = []
  await settleBets(db, f2.id, (e) => published.push(e))
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_win')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100 + 400)
  expect(published).toContainEqual({ type: 'bet-settled', sweepId: 'default' })
})

test('settleParlay is idempotent (no double payout)', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_idem', 50, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f1.id))
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f2.id))
  await settleBets(db, f1.id); await settleBets(db, f2.id)
  const bal = await balanceOf(db, 'default', p.id)
  await settleParlay(db, 'par_idem'); await settleBets(db, f2.id)
  expect(await balanceOf(db, 'default', p.id)).toBe(bal)
  expect(bal).toBe(start - 50 + 200)
})

test('settleStaleBets rolls up a parlay whose legs were graded but the parent stayed open', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_stale', 100, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(bet).set({ status: 'won' }).where(eq(bet.parlayId, 'par_stale'))
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f1.id))
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f2.id))
  const published = []
  await settleStaleBets(db, (e) => published.push(e))
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_stale')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100 + 400)
  expect(published).toContainEqual({ type: 'bet-settled', sweepId: 'default' })
})
