import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, competition, sweep } from '../src/db/schema.js'
import { fakeStripe } from './helpers/fake-stripe.js'

const { pool, db } = openTestDb()
const stripeFake = fakeStripe()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', stripe: stripeFake, stripePriceId: 'price_test5' })
const M = { headers: { 'x-account-token': 'billsession' } }
const COMP = 'apibasketball:12:billing-routes'

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_bill', email: 'bill@x.test', trialEndsAt: new Date(Date.now() + 86400_000) })
  await db.insert(accountSession).values({ token: 'billsession', accountId: 'ac_bill', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(competition).values({ id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'billing-routes', format: 'league', name: 'B' }).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_bill'))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(accountSession).where(eq(accountSession.token, 'billsession'))
  await db.delete(account).where(eq(account.id, 'ac_bill'))
  await app.close(); await pool.end()
})

test('checkout: no live sweeps → 409; with a sweep → customer created once + session url', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })).statusCode).toBe(409)

  await db.insert(sweep).values({ id: 'sw_bill_1', name: 'B1', kind: 'token', memberToken: 'bm1', adminToken: 'ba1', competitionId: COMP, accountId: 'ac_bill' })
  const r = await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })
  expect(r.statusCode).toBe(200)
  expect(r.json()).toEqual({ url: 'https://checkout.stripe.test/s1' })
  expect(stripeFake.calls.customersCreate).toHaveLength(1)
  expect(stripeFake.calls.checkoutCreate[0]).toMatchObject({
    mode: 'subscription', customer: 'cus_fake1', client_reference_id: 'ac_bill',
    line_items: [{ price: 'price_test5', quantity: 1 }],
  })
  const [acct] = await db.select().from(account).where(eq(account.id, 'ac_bill'))
  expect(acct.stripeCustomerId).toBe('cus_fake1') // stored immediately, reused next time

  await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })
  expect(stripeFake.calls.customersCreate).toHaveLength(1) // not recreated
})

test('status + portal + already-subscribed guard', async () => {
  const s1 = (await app.inject({ method: 'GET', url: '/api/account/billing', ...M })).json()
  expect(s1).toMatchObject({ subscribed: false, subscriptionStatus: null, liveSweeps: 1, quantity: 0 })

  expect((await app.inject({ method: 'POST', url: '/api/account/billing/portal', ...M })).statusCode).toBe(200) // customer exists from checkout
  expect(stripeFake.calls.portalCreate[0]).toMatchObject({ customer: 'cus_fake1' })

  await db.update(account).set({ subscriptionStatus: 'active' }).where(eq(account.id, 'ac_bill'))
  expect((await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })).statusCode).toBe(409)
  const s2 = (await app.inject({ method: 'GET', url: '/api/account/billing', ...M })).json()
  expect(s2).toMatchObject({ subscribed: true, subscriptionStatus: 'active', quantity: 1 })
  expect((await app.inject({ method: 'GET', url: '/api/account/billing' })).statusCode).toBe(401) // auth required
})
