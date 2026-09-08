import { expect, test, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { memberCookie, ownerHeaders } from './helpers/session.js'
import { account } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_other', email: 'other@example.test', subscriptionStatus: 'active',
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

const whoami = (headers) => app.inject({
  method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', ...headers },
})

test('the owning account is admin of its own sweep', async () => {
  const res = await whoami({ cookie: await memberCookie(app), ...(await ownerHeaders(db)) })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'admin' })
})

// The check is per-sweep, not a per-account flag. This is the test that proves it:
// a perfectly valid account session on a sweep it does not own is just a member.
test('a different account is only a member', async () => {
  const res = await whoami({ cookie: await memberCookie(app), ...(await ownerHeaders(db, 'ac_other')) })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'member' })
})

test('no account header falls back to the cookie role', async () => {
  const res = await whoami({ cookie: await memberCookie(app) })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'member' })
})

// The floor under all of this: with the default-sweep fallback gone, a request that
// proves nothing is a member of nothing — not silently a member of the seeded sweep.
test('an anonymous cookieless request is 401, not a member of anything', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap' })
  expect(res.statusCode).toBe(401)
})

test('the passcode login is gone', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: '2026' } })
  expect(res.statusCode).toBe(404)
})
