import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet, parlay } from '../src/db/schema.js'
import { regradeGs } from '../src/coins/regrade-gs.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]
// A goalscorer bet mis-settled as 'lost' under the old exact-name match: the stake ledger
// row exists (deducted), but no payout row — exactly the pre-fix prod state.
async function lostGsBet(id, f, p, selection, stake, odds, parlayId = null) {
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -stake, refId: id })
  await db.insert(bet).values({ id, sweepId: 'default', personId: p.id, fixtureId: f.id, market: 'gs',
    selection, stake, oddsDecimal: String(odds), book: 'Bet365', potentialPayout: Math.round(stake * odds),
    status: 'lost', settledAt: new Date(), parlayId })
}

async function finalWithHaalandGoal() {
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: f.t2Code, regScore1: 1, regScore2: 2,
    events: [{ type: 'goal', player: 'E. Haaland', minute: 86, detail: 'Normal Goal' }] }).where(eq(fixture.id, f.id))
  return (await db.select().from(fixture).where(eq(fixture.id, f.id)))[0]
}

test('regradeGs flips a mis-settled standalone goalscorer bet to won and pays it', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  const f = await finalWithHaalandGoal()
  await lostGsBet('gs_haaland', f, p, 'Erling Haaland', 100, 3)  // scored (E. Haaland) → should win
  await lostGsBet('gs_nobody', f, p, 'Random Nobody', 100, 5)    // didn't score → stays lost
  const before = await balanceOf(db, 'default', p.id)            // both stakes already deducted

  const summary = await regradeGs(db)
  expect(summary.regraded).toBe(1)
  expect((await db.select().from(bet).where(eq(bet.id, 'gs_haaland')))[0].status).toBe('won')
  expect((await db.select().from(bet).where(eq(bet.id, 'gs_nobody')))[0].status).toBe('lost')
  expect(await balanceOf(db, 'default', p.id)).toBe(before + 300) // payout = stake*odds returned

  // idempotent: a second run finds nothing to flip and pays nothing more
  expect((await regradeGs(db)).regraded).toBe(0)
  expect(await balanceOf(db, 'default', p.id)).toBe(before + 300)
})

test('regradeGs reopens a parlay lost only because of the goalscorer leg and pays it out', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  const f = await finalWithHaalandGoal()

  // Parlay: a winning 1x2 leg + the wrongly-lost goalscorer leg. The parlay itself was graded
  // 'lost' off the bad leg; the stake is deducted, no payout yet.
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -100, refId: 'par1' })
  await db.insert(parlay).values({ id: 'par1', sweepId: 'default', personId: p.id, stake: 100,
    combinedOdds: '6', potentialPayout: 600, status: 'lost', settledAt: new Date() })
  await db.insert(bet).values({ id: 'leg_win', sweepId: 'default', personId: p.id, fixtureId: f.id, market: '1x2',
    selection: 'AWAY', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'won', parlayId: 'par1' })
  await lostGsBet('leg_gs', f, p, 'Erling Haaland', 0, 3, 'par1')
  const before = await balanceOf(db, 'default', p.id)            // parlay stake already deducted

  const summary = await regradeGs(db)
  expect(summary.parlays).toBe(1)
  expect((await db.select().from(bet).where(eq(bet.id, 'leg_gs')))[0].status).toBe('won')
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par1')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(before + 600) // parlay payout
})
