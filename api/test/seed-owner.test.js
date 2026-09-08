import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { account, sweep } from '../src/db/schema.js'
import { GOOD_STANDING } from '../src/accounts/billing.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

// The seeded sweep is the one every other test file shares. It was accountless, which
// is the single shape sweepIsLive short-circuits on (accounts/billing.js:12) — so the
// suite never exercised the ownership path it is about to depend on.
test('the seeded sweep is owned by an account in good standing', async () => {
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(row.accountId).toBe('ac_seed')
  const [acc] = await db.select().from(account).where(eq(account.id, 'ac_seed'))
  expect(GOOD_STANDING).toContain(acc.subscriptionStatus)
})

// Not a gating test: POST /api/session is exempt (sweeps/read-only.js:4) and carries no
// cookie, so readOnlyGate returns before sweepLiveNow either way. What it does prove is
// that the seed minted a working memberToken — which Task 2's memberCookie() rides on.
test('the seeded member token mints a session', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'platform.test' },
    payload: { token: 'seedmembertoken000000' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().sweepId).toBe('default')
})
