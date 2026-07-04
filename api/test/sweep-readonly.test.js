import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, competition, sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
const COMP = 'apibasketball:12:readonly'
const H = { host: 'platform.test' }

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_ro', email: 'ro@x.test', subscriptionStatus: 'canceled' })
  await db.insert(competition).values({ id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'readonly', format: 'league', name: 'RO' }).onConflictDoNothing()
  await db.insert(sweep).values({ id: 'sw_ro', name: 'Lapsed', kind: 'token', memberToken: 'romember', adminToken: 'roadmin', competitionId: COMP, accountId: 'ac_ro' })
})
afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.id, 'sw_ro'))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(account).where(eq(account.id, 'ac_ro'))
  await app.close(); await pool.end()
})

async function memberCookie() {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: H, payload: { token: 'romember' } })
  expect(res.statusCode).toBe(200) // sign-in on a lapsed sweep MUST still work (view access)
  return res.headers['set-cookie']
}

test('lapsed sweep: reads 200 + readOnly flag, writes 403, sign-in exempt', async () => {
  const cookie = await memberCookie()
  const boot = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { ...H, cookie } })
  expect(boot.statusCode).toBe(200)
  expect(boot.json().readOnly).toBe(true)
  expect((await app.inject({ method: 'GET', url: '/api/fixtures', headers: { ...H, cookie } })).statusCode).toBe(200)

  // schema-valid payload (POST /api/support requires fixtureId/personId/teamCode; body
  // validation runs before preHandler, so a shape-valid-but-nonexistent body still reaches
  // the read-only gate, which 403s before the handler would 400 on unknown_fixture).
  const write = await app.inject({ method: 'POST', url: '/api/support', headers: { ...H, cookie }, payload: { fixtureId: 'nope', personId: 'nope', teamCode: 'any' } })
  expect(write.statusCode).toBe(403)
  expect(write.json()).toEqual({ error: 'sweep_readonly' })

  // renewal flips it back with zero state writes on the sweep
  await db.update(account).set({ subscriptionStatus: 'active' }).where(eq(account.id, 'ac_ro'))
  expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { ...H, cookie } })).json().readOnly).toBe(false)
  await db.update(account).set({ subscriptionStatus: 'canceled' }).where(eq(account.id, 'ac_ro'))
})

test('ops (unowned) sweeps are never read-only', async () => {
  // non-platform host resolves the seeded default sweep (accountId null)
  const boot = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'localhost:3000' } })
  expect(boot.statusCode).toBe(200)
  expect(boot.json().readOnly).toBe(false)
})
