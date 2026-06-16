import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet } from '../src/db/schema.js'
import { fixtureResult, settleBets } from '../src/coins/settle.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]
async function placeRaw(f, p, selection, stake, odds) {
  const id = `bet_${selection}_${stake}`
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -stake, refId: id })
  await db.insert(bet).values({ id, sweepId: 'default', personId: p.id, fixtureId: f.id, selection, stake,
    oddsDecimal: String(odds), book: 'Pinnacle', potentialPayout: Math.round(stake * odds), status: 'open' })
  return id
}

test('fixtureResult prefers winnerCode, falls back to the group score', () => {
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: 'arg' })).toBe('HOME')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: 'bra' })).toBe('AWAY')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: 'DRAW' })).toBe('DRAW')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: null, score1: 2, score2: 0 })).toBe('HOME')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: null, score1: 1, score2: 1 })).toBe('DRAW')
  expect(fixtureResult({ winnerCode: null, score1: null, score2: null })).toBeNull()
})

test('settleBets pays winners, busts losers, and is idempotent', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code }).where(eq(fixture.id, f.id))
  const startBal = await balanceOf(db, 'default', p.id)
  await placeRaw(f, p, 'HOME', 100, 2)  // wins → +200
  await placeRaw(f, p, 'AWAY', 100, 4)  // loses
  const published = []
  await settleBets(db, f.id, (e) => published.push(e))
  expect(await balanceOf(db, 'default', p.id)).toBe(startBal - 200 + 200)
  const rows = await db.select().from(bet).where(eq(bet.fixtureId, f.id))
  expect(rows.find((b) => b.selection === 'HOME').status).toBe('won')
  expect(rows.find((b) => b.selection === 'AWAY').status).toBe('lost')
  expect(published).toEqual([{ type: 'bet-settled', sweepId: 'default' }])
  const again = []
  await settleBets(db, f.id, (e) => again.push(e))
  expect(again).toEqual([])
  expect(await balanceOf(db, 'default', p.id)).toBe(startBal - 200 + 200)
})
