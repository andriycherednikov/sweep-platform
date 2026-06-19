// api/test/admin-settle-stale.test.js
import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const PASS = '1234'
let dir, app, cookie
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-settle-'))
  app = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's' })
  await app.ready()
  cookie = (await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(bet); await db.delete(coinLedger) })

test('POST /api/admin/settle-stale requires admin', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/settle-stale' })
  expect(res.statusCode).toBe(403)
})

test('POST /api/admin/settle-stale grades open bets on already-final fixtures', async () => {
  const [p] = await db.select().from(person).limit(1)
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code, regScore1: 2, regScore2: 0 }).where(eq(fixture.id, f.id))
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -100, refId: 'b_stale' })
  await db.insert(bet).values({ id: 'b_stale', sweepId: 'default', personId: p.id, fixtureId: f.id, selection: 'HOME',
    stake: 100, oddsDecimal: '2', book: 'Pinnacle', potentialPayout: 200, status: 'open' })

  const res = await app.inject({ method: 'POST', url: '/api/admin/settle-stale', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ swept: 1 })
  const [b] = await db.select().from(bet).where(eq(bet.id, 'b_stale'))
  expect(b.status).toBe('won')
})
