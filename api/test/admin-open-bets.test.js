// api/test/admin-open-bets.test.js
import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { event, person, coinLedger, bet, parlay } from '../src/db/schema.js'
import { detailMerge } from '../src/db/event-shape.js'

const { pool, db } = openTestDb()
const PASS = '1234'
let dir, app, cookie
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-openbets-'))
  app = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's' })
  await app.ready()
  cookie = (await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger) })

test('GET /api/admin/open-bets requires admin', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/open-bets' })
  expect(res.statusCode).toBe(403)
})

test('groups open bets by person, annotates fixture status, flags stale, and totals', async () => {
  const [pa, pb] = await db.select().from(person).limit(2)
  const [ffinal, fup1, fup2] = await db.select().from(event).limit(3)
  await db.update(event).set({ status: 'final', detail: detailMerge({ reg: [1, 0] }) }).where(eq(event.id, ffinal.id))
  await db.update(event).set({ status: 'upcoming' }).where(eq(event.id, fup1.id))
  await db.update(event).set({ status: 'upcoming' }).where(eq(event.id, fup2.id))

  // A: a stale single (open on an already-final fixture)
  await db.insert(bet).values({ id: 'b_stale', sweepId: 'default', personId: pa.id, fixtureId: ffinal.id, selection: 'HOME',
    market: '1x2', stake: 100, oddsDecimal: '2', potentialPayout: 200, status: 'open' })
  // B: a normal upcoming single (not stale)
  await db.insert(bet).values({ id: 'b_up', sweepId: 'default', personId: pb.id, fixtureId: fup1.id, selection: 'AWAY',
    market: '1x2', stake: 50, oddsDecimal: '3', potentialPayout: 150, status: 'open' })
  // A: an open parlay with two upcoming legs (not stale — matches not done yet)
  await db.insert(parlay).values({ id: 'par_x', sweepId: 'default', personId: pa.id, stake: 20, combinedOdds: '6', potentialPayout: 120, status: 'open' })
  await db.insert(bet).values({ id: 'leg1', sweepId: 'default', personId: pa.id, fixtureId: fup1.id, parlayId: 'par_x', selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })
  await db.insert(bet).values({ id: 'leg2', sweepId: 'default', personId: pa.id, fixtureId: fup2.id, parlayId: 'par_x', selection: 'AWAY', market: '1x2', stake: 0, oddsDecimal: '3', potentialPayout: 0, status: 'open' })

  const res = await app.inject({ method: 'GET', url: '/api/admin/open-bets', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const body = res.json()

  expect(body.totalOpen).toBe(3)   // 2 singles + 1 parlay
  expect(body.totalStale).toBe(1)  // just the stale single

  // person A (has the stale bet) sorts first
  expect(body.people[0].person.id).toBe(pa.id)
  const a = body.people.find((g) => g.person.id === pa.id)
  const b = body.people.find((g) => g.person.id === pb.id)

  expect(a.openCount).toBe(2)
  expect(a.staleCount).toBe(1)
  expect(a.singles).toHaveLength(1)
  expect(a.singles[0].stale).toBe(true)
  expect(a.singles[0].fixtureStatus).toBe('final')
  expect(a.singles[0].stake).toBe(100)
  expect(a.parlays).toHaveLength(1)
  expect(a.parlays[0].stale).toBe(false)
  expect(a.parlays[0].legs).toHaveLength(2)
  expect(a.parlays[0].legs[0].fixtureStatus).toBe('upcoming')

  expect(b.openCount).toBe(1)
  expect(b.staleCount).toBe(0)
  expect(b.singles[0].stale).toBe(false)
  expect(b.singles[0].fixtureStatus).toBe('upcoming')
})

test('flags a parlay stale once every leg grades (all legs final and graded)', async () => {
  const [pa] = await db.select().from(person).limit(1)
  const [f1, f2] = await db.select().from(event).limit(2)
  await db.update(event).set({ status: 'final', detail: detailMerge({ reg: [1, 0] }) }).where(eq(event.id, f1.id))
  await db.update(event).set({ status: 'final', detail: detailMerge({ reg: [0, 0] }) }).where(eq(event.id, f2.id))
  await db.insert(parlay).values({ id: 'par_done', sweepId: 'default', personId: pa.id, stake: 10, combinedOdds: '4', potentialPayout: 40, status: 'open' })
  await db.insert(bet).values({ id: 'dleg1', sweepId: 'default', personId: pa.id, fixtureId: f1.id, parlayId: 'par_done', selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })
  await db.insert(bet).values({ id: 'dleg2', sweepId: 'default', personId: pa.id, fixtureId: f2.id, parlayId: 'par_done', selection: 'DRAW', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })

  const res = await app.inject({ method: 'GET', url: '/api/admin/open-bets', headers: { cookie } })
  const body = res.json()
  expect(body.totalStale).toBe(1)
  expect(body.people[0].parlays[0].stale).toBe(true)
})

// findings 3 & 4: a parlay settles the moment ANY leg loses, so the audit must flag it
// stale even while other legs are still upcoming — matching what "Settle stale bets" does.
test('flags a parlay stale when one leg has already lost, even with an upcoming leg', async () => {
  const [pa] = await db.select().from(person).limit(1)
  const [f1, f2] = await db.select().from(event).limit(2)
  await db.update(event).set({ status: 'final', detail: detailMerge({ reg: [0, 2] }) }).where(eq(event.id, f1.id))
  await db.update(event).set({ status: 'upcoming', detail: detailMerge({ reg: null }) }).where(eq(event.id, f2.id))
  await db.insert(parlay).values({ id: 'par_lost', sweepId: 'default', personId: pa.id, stake: 10, combinedOdds: '5', potentialPayout: 50, status: 'open' })
  await db.insert(bet).values({ id: 'lleg1', sweepId: 'default', personId: pa.id, fixtureId: f1.id, parlayId: 'par_lost', selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' }) // HOME lost
  await db.insert(bet).values({ id: 'lleg2', sweepId: 'default', personId: pa.id, fixtureId: f2.id, parlayId: 'par_lost', selection: 'AWAY', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })

  const res = await app.inject({ method: 'GET', url: '/api/admin/open-bets', headers: { cookie } })
  const body = res.json()
  expect(body.totalStale).toBe(1)
  expect(body.people[0].parlays[0].stale).toBe(true)
})

// findings 1 & 5: a single on a final fixture the settler CAN'T grade yet (no score data)
// must NOT be flagged stale — the button can't settle it, so don't tell the admin to.
test('does not flag a single on a final fixture that has no result data yet', async () => {
  const [pa] = await db.select().from(person).limit(1)
  const [f1] = await db.select().from(event).limit(1)
  await db.update(event).set({ status: 'final', winnerCode: null, detail: detailMerge({ reg: null }) }).where(eq(event.id, f1.id))
  await db.insert(bet).values({ id: 'b_ungrade', sweepId: 'default', personId: pa.id, fixtureId: f1.id, selection: 'HOME', market: '1x2', stake: 30, oddsDecimal: '2', potentialPayout: 60, status: 'open' })

  const res = await app.inject({ method: 'GET', url: '/api/admin/open-bets', headers: { cookie } })
  const body = res.json()
  expect(body.totalOpen).toBe(1)
  expect(body.totalStale).toBe(0)
  expect(body.people[0].singles[0].fixtureStatus).toBe('final')
  expect(body.people[0].singles[0].stale).toBe(false)
})
