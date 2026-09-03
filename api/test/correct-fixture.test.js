// A wrong score from the feed settles a sweep wrong, and no vendor ships corrections —
// API-Sports' own terms say bad data "does not constitute a valid reason for a refund".
// With wagering on, that is a money dispute with no operator remedy, so correcting a
// result has to unwind everything the wrong one paid out, not just overwrite the score.
import { expect, test, afterAll, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { event, person, coinLedger, bet, support, ranking } from '../src/db/schema.js'
import { detailMerge } from '../src/db/event-shape.js'
import { settleBets } from '../src/wagering/settle.js'
import { grantMatchRewards } from '../src/wagering/rewards.js'
import { correctFixture } from '../src/corrections.js'
import { recomputeStandings } from '../src/worker/recompute-standings.js'
import { ensureGrants, balanceOf } from '../src/wagering/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => {
  await db.delete(bet); await db.delete(coinLedger); await db.delete(support)
})

const aPerson = async () => (await db.select().from(person).limit(1))[0]

async function placeRaw(f, p, selection, stake, odds) {
  const id = `bet_cx_${selection}_${stake}`
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -stake, refId: id })
  await db.insert(bet).values({
    id, sweepId: 'default', personId: p.id, fixtureId: f.id, market: 'ml', selection, stake,
    oddsDecimal: String(odds), book: 'Pinnacle', potentialPayout: Math.round(stake * odds), status: 'open',
  })
  return id
}

// The feed says the home team won 2–0. It was actually 0–1 to the away team.
async function fixtureSettledWrong() {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  const [f] = await db.select().from(event).limit(1)
  await db.update(event)
    .set({ status: 'final', score1: 2, score2: 0, winnerCode: f.c1Code, detail: detailMerge({ reg: [2, 0] }) })
    .where(eq(event.id, f.id))
  const home = await placeRaw(f, p, 'HOME', 100, 2)
  const away = await placeRaw(f, p, 'AWAY', 100, 4)
  await db.insert(support).values({ sweepId: 'default', personId: p.id, fixtureId: f.id, teamCode: f.c2Code })
  await settleBets(db, f.id)
  await grantMatchRewards(db, f.id)
  return { p, f, home, away }
}

test('a corrected score claws back the payout the wrong one made', async () => {
  const { f, home, away } = await fixtureSettledWrong()
  // the wrong score paid the HOME bet and nothing else
  expect((await db.select().from(coinLedger).where(eq(coinLedger.type, 'payout')))
    .map((r) => [r.refId, r.amount])).toEqual([[home, 200]])

  const out = await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'feed had the sides swapped' })

  const rows = await db.select().from(bet).where(eq(bet.fixtureId, f.id))
  expect(rows.find((b) => b.id === home).status).toBe('lost') // was won on the wrong score
  expect(rows.find((b) => b.id === away).status).toBe('won')
  // exactly one payout, for the bet that actually won — not both, not neither, and the
  // clawed-back one leaves no trace behind
  expect((await db.select().from(coinLedger).where(eq(coinLedger.type, 'payout')))
    .map((r) => [r.refId, r.amount])).toEqual([[away, 400]])
  expect(out.reopenedBets).toBe(2)
})

test('prediction rewards are re-granted against the corrected result', async () => {
  const { p, f } = await fixtureSettledWrong()
  // they picked the away team, so on the WRONG score (home win) they got nothing
  expect(await db.select().from(coinLedger)
    .where(and(eq(coinLedger.type, 'predict'), eq(coinLedger.refId, f.id)))).toHaveLength(0)

  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'feed had the sides swapped' })

  const predicts = await db.select().from(coinLedger)
    .where(and(eq(coinLedger.type, 'predict'), eq(coinLedger.refId, f.id)))
  expect(predicts).toHaveLength(1) // now correct, and exactly one row — not a duplicate grant
  expect(predicts[0].personId).toBe(p.id)
})

test('a reward earned on the wrong score is taken back when the score changes', async () => {
  const p = await aPerson()
  const [f] = await db.select().from(event).limit(1)
  await db.update(event)
    .set({ status: 'final', score1: 2, score2: 0, winnerCode: f.c1Code, detail: detailMerge({ reg: [2, 0] }) })
    .where(eq(event.id, f.id))
  await db.insert(support).values({ sweepId: 'default', personId: p.id, fixtureId: f.id, teamCode: f.c1Code })
  await grantMatchRewards(db, f.id)
  expect(await db.select().from(coinLedger)
    .where(and(eq(coinLedger.type, 'predict'), eq(coinLedger.refId, f.id)))).toHaveLength(1)

  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'home never scored' })

  expect(await db.select().from(coinLedger)
    .where(and(eq(coinLedger.type, 'predict'), eq(coinLedger.refId, f.id)))).toHaveLength(0)
})

test('the stake is never disturbed — only what settlement paid out', async () => {
  const { p, f, home } = await fixtureSettledWrong()
  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'x' })
  const stakes = await db.select().from(coinLedger).where(eq(coinLedger.type, 'stake'))
  expect(stakes).toHaveLength(2)
  expect(stakes.find((s) => s.refId === home).amount).toBe(-100)
  expect(p.id).toBeTruthy()
})

test('correcting is idempotent — running it twice does not pay twice', async () => {
  const { p, f } = await fixtureSettledWrong()
  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'x' })
  const once = await balanceOf(db, 'default', p.id)
  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'x' })
  expect(await balanceOf(db, 'default', p.id)).toBe(once)
})

test('the score, the derived winner and the regulation pair all move together', async () => {
  const { f } = await fixtureSettledWrong()
  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'x' })
  const [row] = await db.select().from(event).where(eq(event.id, f.id))
  expect(row.score1).toBe(0)
  expect(row.score2).toBe(1)
  expect(row.winnerCode).toBe(f.c2Code)
  // football grades on regulation; leaving detail.reg stale would re-settle on the old score
  expect(row.detail.reg).toEqual([0, 1])
})

test('a correction leaves a record of who changed what and why', async () => {
  const { f } = await fixtureSettledWrong()
  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'feed had the sides swapped' })
  const [row] = await db.select().from(event).where(eq(event.id, f.id))
  expect(row.detail.correction).toMatchObject({ from: [2, 0], to: [0, 1], reason: 'feed had the sides swapped' })
  expect(row.detail.correction.at).toBeTruthy()
})

test('standings are recomputed, so the table matches the corrected result', async () => {
  const { f } = await fixtureSettledWrong()
  const pointsFor = async (code) => (await db.select().from(ranking)
    .where(and(eq(ranking.competitionId, f.competitionId), eq(ranking.competitorCode, code))))[0].points
  // baseline against the WRONG score — the seeded ranking rows predate it, so comparing
  // to those would compare against nothing in particular
  await recomputeStandings(db, f.competitionId)
  const [lostBefore, wonBefore] = [await pointsFor(f.c2Code), await pointsFor(f.c1Code)]

  await correctFixture(db, f.id, { score1: 0, score2: 1, reason: 'x' })

  expect(await pointsFor(f.c2Code)).toBe(lostBefore + 3) // 0-2 loss became a 1-0 win
  expect(await pointsFor(f.c1Code)).toBe(wonBefore - 3)
})

// The route half. A correction rewrites shared competition data, so the guard on it is
// the only thing standing between one group's admin and everyone else's results.
test('the correction route is operator-only, and rejects a silent one', async () => {
  const { buildApp } = await import('../src/app.js')
  const app = buildApp(db, { superToken: 'super-secret', sessionSecret: 's' })
  await app.ready()
  try {
    const [f] = await db.select().from(event).limit(1)
    const url = `/api/super/fixtures/${f.id}/correct`
    const body = { score1: 0, score2: 1, reason: 'feed had the sides swapped' }

    // no super cookie at all
    expect((await app.inject({ method: 'POST', url, payload: body })).statusCode).toBe(401)

    const login = await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'super-secret' } })
    const cookie = login.headers['set-cookie']

    // a reason is required — a correction nobody can explain later is a bug, not a fix
    expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload: { score1: 0, score2: 1 } })).statusCode).toBe(400)

    const ok = await app.inject({ method: 'POST', url, headers: { cookie }, payload: body })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ fixtureId: f.id, to: [0, 1] })

    const missing = await app.inject({ method: 'POST', url: '/api/super/fixtures/nope/correct', headers: { cookie }, payload: body })
    expect(missing.statusCode).toBe(404)
  } finally {
    await app.close()
  }
})
