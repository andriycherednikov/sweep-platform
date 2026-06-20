import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet } from '../src/db/schema.js'
import { fixtureResult, settleBets, settleStaleBets } from '../src/coins/settle.js'
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
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code, regScore1: 2, regScore2: 0 }).where(eq(fixture.id, f.id))
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

import { resolveBet, regulationResult } from '../src/coins/settle.js'

const fx = (over = {}) => ({ t1Code: 'arg', t2Code: 'bra', winnerCode: null, score1: null, score2: null,
  regScore1: null, regScore2: null, htScore1: null, htScore2: null, events: [], ...over })

test('regulationResult reads the 90-minute score, ignoring winnerCode', () => {
  // 1-1 at 90', won on penalties (winnerCode=arg) → the Match Winner market is a DRAW
  expect(regulationResult({ regScore1: 1, regScore2: 1, winnerCode: 'arg', t1Code: 'arg', t2Code: 'bra' })).toBe('DRAW')
  expect(regulationResult({ regScore1: 2, regScore2: 0 })).toBe('HOME')
  expect(regulationResult({ regScore1: 0, regScore2: 1 })).toBe('AWAY')
  expect(regulationResult({ regScore1: null, regScore2: null })).toBeNull()
})

test('resolveBet 1x2 from the regulation result', () => {
  expect(resolveBet('1x2', 'HOME', null, fx({ regScore1: 2, regScore2: 0 }))).toBe('won')
  expect(resolveBet('1x2', 'DRAW', null, fx({ regScore1: 1, regScore2: 1 }))).toBe('won')
  // knockout: 1-1 at 90', won on pens → DRAW wins, HOME loses (ET-inclusive score1/score2 ignored)
  expect(resolveBet('1x2', 'DRAW', null, fx({ regScore1: 1, regScore2: 1, score1: 2, score2: 1, winnerCode: 'arg' }))).toBe('won')
  expect(resolveBet('1x2', 'HOME', null, fx({ regScore1: 1, regScore2: 1, score1: 2, score2: 1, winnerCode: 'arg' }))).toBe('lost')
})

test('resolveBet ou25 from regulation goals (not extra time)', () => {
  expect(resolveBet('ou25', 'OVER', 2.5, fx({ regScore1: 2, regScore2: 1 }))).toBe('won')
  // 1-1 at 90' (UNDER) that becomes 3-2 in ET still settles on the 90' total
  expect(resolveBet('ou25', 'UNDER', 2.5, fx({ regScore1: 1, regScore2: 1, score1: 3, score2: 2 }))).toBe('won')
})

test('resolveBet cards from card-event count vs line', () => {
  const events = [{ type: 'card' }, { type: 'card' }, { type: 'card' }, { type: 'card' }, { type: 'goal' }]
  expect(resolveBet('cards', 'OVER', 3.5, fx({ events }))).toBe('won')
  expect(resolveBet('cards', 'UNDER', 3.5, fx({ events }))).toBe('lost')
})

test('resolveBet cards counts only regulation (minute <= 90) cards', () => {
  const events = [{ type: 'card', minute: 30 }, { type: 'card', minute: 80 }, { type: 'card', minute: 90 },
    { type: 'card', minute: 105 }, { type: 'card', minute: 118 }] // 3 in regulation, 2 in ET
  expect(resolveBet('cards', 'OVER', 3.5, fx({ events }))).toBe('lost') // 3 cards, not > 3.5
  expect(resolveBet('cards', 'UNDER', 3.5, fx({ events }))).toBe('won')
})

test('resolveBet fh1x2 from half-time score (or goal-events fallback)', () => {
  expect(resolveBet('fh1x2', 'HOME', null, fx({ htScore1: 1, htScore2: 0 }))).toBe('won')
  expect(resolveBet('fh1x2', 'HOME', null, fx({ events: [{ type: 'goal', teamCode: 'arg', minute: 20 }] }))).toBe('won')
  expect(resolveBet('fh1x2', 'HOME', null, { ...fx(), events: null })).toBeNull()
})

test('resolveBet cs from the regulation score', () => {
  expect(resolveBet('cs', '2:1', null, fx({ regScore1: 2, regScore2: 1 }))).toBe('won')
  expect(resolveBet('cs', '2:1', null, fx({ regScore1: 1, regScore2: 1 }))).toBe('lost')
})

test('settleStaleBets grades open bets left on already-final fixtures', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  const [f] = await db.select().from(fixture).limit(1)
  // fixture is final, but its bet was never settled (worker missed it → stale)
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code, regScore1: 2, regScore2: 0 }).where(eq(fixture.id, f.id))
  const startBal = await balanceOf(db, 'default', p.id)
  await placeRaw(f, p, 'HOME', 100, 2) // should win → +200
  const published = []
  const swept = await settleStaleBets(db, (e) => published.push(e))
  expect(swept).toBe(1)
  const [b] = await db.select().from(bet).where(eq(bet.fixtureId, f.id))
  expect(b.status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(startBal - 100 + 200)
  expect(published).toEqual([{ type: 'bet-settled', sweepId: 'default' }])
  // idempotent: a second sweep finds nothing open and pays nothing more
  const again = []
  expect(await settleStaleBets(db, (e) => again.push(e))).toBe(0)
  expect(again).toEqual([])
  expect(await balanceOf(db, 'default', p.id)).toBe(startBal - 100 + 200)
})

test('settleStaleBets leaves bets on non-final fixtures untouched', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'live', winnerCode: null, score1: null, score2: null }).where(eq(fixture.id, f.id))
  await placeRaw(f, p, 'HOME', 50, 2)
  expect(await settleStaleBets(db, () => {})).toBe(0)
  const [b] = await db.select().from(bet).where(eq(bet.fixtureId, f.id))
  expect(b.status).toBe('open')
})
