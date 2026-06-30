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

test('resolveBet btts from regulation goals (both teams scored at 90)', () => {
  expect(resolveBet('btts', 'YES', null, fx({ regScore1: 1, regScore2: 2 }))).toBe('won')
  expect(resolveBet('btts', 'YES', null, fx({ regScore1: 2, regScore2: 0 }))).toBe('lost')
  expect(resolveBet('btts', 'NO', null, fx({ regScore1: 2, regScore2: 0 }))).toBe('won')
  // 0-0 at 90' that becomes 1-1 in ET still settles NO on the 90' score
  expect(resolveBet('btts', 'NO', null, fx({ regScore1: 0, regScore2: 0, score1: 1, score2: 1 }))).toBe('won')
  expect(resolveBet('btts', 'YES', null, fx())).toBeNull()
})

test('resolveBet dc (double chance) from the regulation result', () => {
  expect(resolveBet('dc', '1X', null, fx({ regScore1: 2, regScore2: 0 }))).toBe('won') // home
  expect(resolveBet('dc', '1X', null, fx({ regScore1: 1, regScore2: 1 }))).toBe('won') // draw
  expect(resolveBet('dc', '1X', null, fx({ regScore1: 0, regScore2: 1 }))).toBe('lost') // away
  expect(resolveBet('dc', '12', null, fx({ regScore1: 0, regScore2: 1 }))).toBe('won') // away
  expect(resolveBet('dc', '12', null, fx({ regScore1: 1, regScore2: 1 }))).toBe('lost') // draw
  expect(resolveBet('dc', 'X2', null, fx({ regScore1: 1, regScore2: 1 }))).toBe('won') // draw
  expect(resolveBet('dc', 'X2', null, fx())).toBeNull()
})

test('resolveBet toq (to qualify) grades on who advanced — ET/penalties aware', () => {
  // 1-1 at 90', won on penalties (winnerCode=arg): To Qualify HOME wins though 1x2 is a draw
  expect(resolveBet('toq', 'HOME', null, fx({ regScore1: 1, regScore2: 1, winnerCode: 'arg' }))).toBe('won')
  expect(resolveBet('toq', 'AWAY', null, fx({ regScore1: 1, regScore2: 1, winnerCode: 'arg' }))).toBe('lost')
  expect(resolveBet('toq', 'AWAY', null, fx({ winnerCode: 'bra' }))).toBe('won')
  expect(resolveBet('toq', 'HOME', null, fx({ winnerCode: null }))).toBeNull() // not final yet
})

test('resolveBet oe (odd/even total goals); 0-0 counts as even', () => {
  expect(resolveBet('oe', 'ODD', null, fx({ regScore1: 2, regScore2: 1 }))).toBe('won')  // 3
  expect(resolveBet('oe', 'EVEN', null, fx({ regScore1: 2, regScore2: 0 }))).toBe('won')  // 2
  expect(resolveBet('oe', 'EVEN', null, fx({ regScore1: 0, regScore2: 0 }))).toBe('won')  // 0 = even
  expect(resolveBet('oe', 'ODD', null, fx({ regScore1: 0, regScore2: 0 }))).toBe('lost')
  expect(resolveBet('oe', 'EVEN', null, fx())).toBeNull()
})

test('resolveBet fhou (first-half O/U) from HT score, with goal-event fallback', () => {
  expect(resolveBet('fhou', 'OVER', 0.5, fx({ htScore1: 1, htScore2: 0 }))).toBe('won')
  expect(resolveBet('fhou', 'UNDER', 0.5, fx({ htScore1: 0, htScore2: 0 }))).toBe('won')
  expect(resolveBet('fhou', 'OVER', 1.5, fx({ htScore1: 1, htScore2: 0 }))).toBe('lost')
  // fallback: count goal events at minute <= 45 when HT score is absent
  expect(resolveBet('fhou', 'OVER', 0.5, fx({ events: [{ type: 'goal', teamCode: 'arg', minute: 20 }] }))).toBe('won')
  expect(resolveBet('fhou', 'OVER', 0.5, { ...fx(), events: null })).toBeNull()
  expect(resolveBet('fhou', 'OVER', null, fx({ htScore1: 1, htScore2: 0 }))).toBeNull() // no line
})

test('resolveBet gs (anytime goalscorer) — v1 all-bets-stand; own goals never count', () => {
  const events = [
    { type: 'goal', player: 'Lionel Messi', minute: 23, detail: 'Normal Goal' },
    { type: 'goal', player: 'Nicolás Otamendi', minute: 60, detail: 'Own Goal' }, // own goal: doesn't count
    { type: 'card', player: 'Whoever', minute: 70 },
  ]
  expect(resolveBet('gs', 'Lionel Messi', null, fx({ events }))).toBe('won')
  expect(resolveBet('gs', 'lionel  messi', null, fx({ events }))).toBe('won')   // case/space-insensitive
  expect(resolveBet('gs', 'Nicolás Otamendi', null, fx({ events }))).toBe('lost') // only an own goal → no
  expect(resolveBet('gs', 'Someone Else', null, fx({ events }))).toBe('lost')     // didn't score → lost (bets stand)
  // goals after 90' don't count toward anytime scorer
  expect(resolveBet('gs', 'Late Sub', null, fx({ events: [{ type: 'goal', player: 'Late Sub', minute: 105, detail: 'Normal Goal' }] }))).toBe('lost')
  expect(resolveBet('gs', 'Lionel Messi', null, { ...fx(), events: null })).toBeNull() // events not polled → leave open
})

test('resolveBet gs matches across API-Football name formats (odds full name vs event initial)', () => {
  // The odds feed names the bet selection "Erling Haaland"; the events feed records the
  // scorer as "E. Haaland". Same player — must settle WON, not LOST.
  const events = [{ type: 'goal', player: 'E. Haaland', minute: 86, detail: 'Normal Goal' }]
  expect(resolveBet('gs', 'Erling Haaland', null, fx({ events }))).toBe('won')
  expect(resolveBet('gs', 'Haaland', null, fx({ events }))).toBe('won')          // surname-only odds value
  // surname matches but the first initial doesn't → different player, still LOST
  expect(resolveBet('gs', 'Mohamed Haaland', null, fx({ events }))).toBe('lost')
  // wrong surname → LOST even if an initial coincides
  expect(resolveBet('gs', 'Erling Solbakken', null, fx({ events }))).toBe('lost')
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
