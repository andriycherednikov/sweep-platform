import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, event, person, coinLedger, bet, parlay } from '../src/db/schema.js'
import { detailMerge } from '../src/db/event-shape.js'
import { settleBets, settleParlay, settleStaleBets } from '../src/coins/settle.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

// finalize a fixture's regulation score in both fixture (legacy) and event (ported reads)
async function finalizeReg(f, s1, s2) {
  await db.update(fixture).set({ status: 'final', regScore1: s1, regScore2: s2 }).where(eq(fixture.id, f.id))
  await db.update(event).set({ status: 'final', detail: detailMerge({ reg: [s1, s2] }) }).where(eq(event.id, f.id))
}

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
  await finalizeReg(f1, 0, 1)
  await settleBets(db, f1.id)
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_lose')))[0].status).toBe('lost')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100)
})

test('a parlay stays open until the last leg, then pays when all legs win', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_win', 100, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await finalizeReg(f1, 1, 0)
  await settleBets(db, f1.id)
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_win')))[0].status).toBe('open')
  await finalizeReg(f2, 2, 1)
  const published = []
  await settleBets(db, f2.id, (e) => published.push(e))
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_win')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100 + 400)
  expect(published).toContainEqual({ type: 'bet-settled', sweepId: 'default' })
})

test('a same-game multi settles both legs on one fixture in one pass, then pays', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1] = await db.select().from(fixture).limit(1)
  const start = await balanceOf(db, 'default', p.id)
  // two legs on the SAME fixture: 1x2 HOME (@2) + ou25 OVER 2.5 (@2) → combined 4
  await makeParlay(p, 'par_sgm', 100, 4, [
    { fixtureId: f1.id, market: '1x2', selection: 'HOME', odds: 2 },
    { fixtureId: f1.id, market: 'ou25', selection: 'OVER', line: 2.5, odds: 2 },
  ])
  // final 2-1: HOME wins AND total 3 > 2.5 → both legs win in the single settleBets pass
  await finalizeReg(f1, 2, 1)
  await settleBets(db, f1.id)
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_sgm')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100 + 400)
})

test('settleParlay is idempotent (no double payout)', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_idem', 50, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await finalizeReg(f1, 1, 0)
  await finalizeReg(f2, 1, 0)
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
  await finalizeReg(f1, 1, 0)
  await finalizeReg(f2, 1, 0)
  const published = []
  await settleStaleBets(db, (e) => published.push(e))
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_stale')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100 + 400)
  expect(published).toContainEqual({ type: 'bet-settled', sweepId: 'default' })
})
