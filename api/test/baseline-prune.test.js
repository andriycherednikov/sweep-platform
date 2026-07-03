import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { event, person, coinLedger, bet, parlay } from '../src/db/schema.js'
import { refundPrunedParlays } from '../src/worker/baseline-sync.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
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
  await refundPrunedParlays(db, [f2.id]) // keep only f2 → f1's leg is dropped → refund whole parlay
  expect(await db.select().from(parlay).where(eq(parlay.id, 'par_p'))).toHaveLength(0) // deleted (cascade legs)
  expect(await db.select().from(bet).where(eq(bet.parlayId, 'par_p'))).toHaveLength(0)
  expect(await balanceOf(db, 'default', p.id)).toBe(start) // stake refunded
})
