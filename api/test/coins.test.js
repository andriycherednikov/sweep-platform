import { expect, test, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { person, coinLedger, bet, fixture } from '../src/db/schema.js'
import { and, eq } from 'drizzle-orm'

const { pool, db } = openTestDb()
const published = []
const app = buildApp(db, { publish: (e) => published.push(e) })
afterAll(async () => { await app.close(); await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(coinLedger); published.length = 0 })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

test('GET /api/coins grants the starting bankroll on first read and returns a wallet', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/coins' })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.weeklyGrant).toBe(1000)
  expect(Array.isArray(body.leaderboard)).toBe(true)
  expect(body.leaderboard.every((e) => e.balance >= 1000)).toBe(true)
  expect(body.bets).toEqual({ open: [], settled: [] })
})

test('GET /api/coins?personId= returns that person balance after their grant', async () => {
  const p = await aPerson()
  const body = (await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` })).json()
  expect(body.balance).toBeGreaterThanOrEqual(1000)
})

async function bettableFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'upcoming', stage: 'group',
    oddsHome: '2.00', oddsDraw: '3.50', oddsAway: '4.00', oddsBook: 'Pinnacle' }).where(eq(fixture.id, f.id))
  return (await db.select().from(fixture).where(eq(fixture.id, f.id)))[0]
}
const balanceOfPerson = async (id) => (await app.inject({ method: 'GET', url: `/api/coins?personId=${id}` })).json().balance

test('POST /api/bet deducts the stake, locks the odds, and returns the new balance', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  const before = await balanceOfPerson(p.id) // also seeds the grant
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 100 } })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.balance).toBe(before - 100)
  expect(body.bet).toMatchObject({ selection: 'HOME', stake: 100, odds: 2, potentialPayout: 200, status: 'open' })
  expect(published.some((e) => e.type === 'bet')).toBe(true)
})

test('POST /api/bet rejects a stake above the balance', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 99999999 } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'insufficient_funds' })
})

test('POST /api/bet rejects once the match is no longer upcoming', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await db.update(fixture).set({ status: 'live' }).where(eq(fixture.id, f.id))
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'betting_closed' })
})

test('POST /api/bet rejects DRAW on a knockout fixture and an unpriced fixture', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await db.update(fixture).set({ stage: 'r16' }).where(eq(fixture.id, f.id))
  expect((await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'DRAW', stake: 10 } })).statusCode).toBe(400)
  await db.update(fixture).set({ stage: 'group', oddsHome: null, oddsDraw: null, oddsAway: null }).where(eq(fixture.id, f.id))
  expect((await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })).json()).toEqual({ error: 'no_odds' })
})

test('POST /api/bet allows multiple independent bets on the same match', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  const before = await balanceOfPerson(p.id)
  await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 50 } })
  const second = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'AWAY', stake: 50 } })
  expect(second.statusCode).toBe(200)
  const wallet = (await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` })).json()
  expect(wallet.bets.open).toHaveLength(2)
  expect(wallet.balance).toBe(before - 100)
})

test('two concurrent full-balance bets cannot overdraw — exactly one wins', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  const before = await balanceOfPerson(p.id) // seed the grant; whole balance
  // both stake the entire balance at once — only one can be funded
  const [a, b] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: before } }),
    app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'AWAY', stake: before } }),
  ])
  const codes = [a.statusCode, b.statusCode].sort()
  expect(codes).toEqual([200, 400])
  const loser = a.statusCode === 400 ? a : b
  expect(loser.json()).toEqual({ error: 'insufficient_funds' })
  const wallet = (await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` })).json()
  expect(wallet.balance).toBe(0)          // never negative
  expect(wallet.bets.open).toHaveLength(1) // only the funded bet landed
})
