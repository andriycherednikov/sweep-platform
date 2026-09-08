import { expect, test, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { memberCookie, ownerHeaders } from './helpers/session.js'
import { account } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
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
