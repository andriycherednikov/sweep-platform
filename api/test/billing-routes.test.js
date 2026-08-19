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

test('zero live sweeps → checkout succeeds with quantity 1', async () => {
  const r0 = await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })
  expect(r0.statusCode).toBe(200)
  expect(r0.json()).toEqual({ url: 'https://checkout.stripe.test/s1' })
  expect(stripeFake.calls.checkoutCreate[0]).toMatchObject({ line_items: [{ price: 'price_test5', quantity: 1 }] })

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

test('cancel flow: the portal is opened on the cancel step and hands the owner back to us', async () => {
  await db.update(account).set({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_fake1' }).where(eq(account.id, 'ac_bill'))
  const r = await app.inject({ method: 'POST', url: '/api/account/billing/portal', ...M, payload: { flow: 'cancel' } })
  expect(r.statusCode).toBe(200)
  const params = stripeFake.calls.portalCreate.at(-1)
  expect(params).toMatchObject({
    customer: 'cus_fake1',
    return_url: 'https://platform.test/account/billing/updated',
    flow_data: {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: 'sub_fake1' },
      after_completion: { type: 'redirect', redirect: { return_url: 'https://platform.test/account/billing/updated' } },
    },
  })
  // the plain portal keeps its own shape: no flow, same landing
  await app.inject({ method: 'POST', url: '/api/account/billing/portal', ...M })
  expect(stripeFake.calls.portalCreate.at(-1).flow_data).toBeUndefined()
  await db.update(account).set({ subscriptionStatus: null, stripeSubscriptionId: null }).where(eq(account.id, 'ac_bill'))
})

test('billing status reports a subscription that is set to stop, and when', async () => {
  const ends = new Date('2099-09-12T00:00:00Z')
  await db.update(account).set({ subscriptionStatus: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: ends }).where(eq(account.id, 'ac_bill'))
  const s = (await app.inject({ method: 'GET', url: '/api/account/billing', ...M })).json()
  expect(s).toMatchObject({ subscribed: true, cancelAtPeriodEnd: true })
  expect(new Date(s.currentPeriodEnd).toISOString()).toBe(ends.toISOString())
  await db.update(account).set({ subscriptionStatus: null, cancelAtPeriodEnd: false, currentPeriodEnd: null }).where(eq(account.id, 'ac_bill'))
})

test('confirm: the return from checkout is verified against Stripe, not trusted', async () => {
  // a session belonging to someone else must not activate this account
  const foreign = fakeStripe({ session: { id: 'cs_foreign_1', status: 'complete', payment_status: 'paid', client_reference_id: 'ac_someone_else', customer: 'cus_x', subscription: 'sub_x' } })
  const appX = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', stripe: foreign, stripePriceId: 'price_test5' })
  await appX.ready()
  const bad = await appX.inject({ method: 'POST', url: '/api/account/billing/confirm', ...M, payload: { sessionId: 'cs_foreign_1' } })
  expect(bad.statusCode).toBe(404)
  await appX.close()

  // an unpaid session reports back as pending, and changes nothing
  const unpaid = fakeStripe({ session: { id: 'cs_pending_1', status: 'open', payment_status: 'unpaid', client_reference_id: 'ac_bill', customer: 'cus_fake1', subscription: null } })
  const appP = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', stripe: unpaid, stripePriceId: 'price_test5' })
  await appP.ready()
  const pending = await appP.inject({ method: 'POST', url: '/api/account/billing/confirm', ...M, payload: { sessionId: 'cs_pending_1' } })
  expect(pending.statusCode).toBe(200)
  expect(pending.json()).toMatchObject({ subscribed: false })
  await appP.close()

  // the real thing: the account is reconciled from Stripe without waiting for the webhook
  const ok = await app.inject({ method: 'POST', url: '/api/account/billing/confirm', ...M, payload: { sessionId: 'cs_fake1' } })
  expect(ok.statusCode).toBe(200)
  expect(ok.json()).toMatchObject({ subscribed: true, subscriptionStatus: 'active' })
  const [acct] = await db.select().from(account).where(eq(account.id, 'ac_bill'))
  expect(acct).toMatchObject({ stripeSubscriptionId: 'sub_fake1', stripeSubscriptionItemId: 'si_fake1', subscriptionStatus: 'active' })
  await db.update(account).set({ subscriptionStatus: null, stripeSubscriptionId: null, stripeSubscriptionItemId: null }).where(eq(account.id, 'ac_bill'))
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

test('checkout + portal: 503 billing_unconfigured when Stripe is not wired up', async () => {
  const app2 = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' }) // no stripe opt → app2.stripe is null
  await app2.ready()
  await db.insert(account).values({ id: 'ac_bill_nostripe', email: 'nostripe@x.test' })
  await db.insert(accountSession).values({ token: 'nostripesession', accountId: 'ac_bill_nostripe', expiresAt: new Date(Date.now() + 3600_000) })
  const M2 = { headers: { 'x-account-token': 'nostripesession' } }
  const rc = await app2.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M2 })
  expect(rc.statusCode).toBe(503)
  expect(rc.json()).toEqual({ error: 'billing_unconfigured' })
  const rp = await app2.inject({ method: 'POST', url: '/api/account/billing/portal', ...M2 })
  expect(rp.statusCode).toBe(503)
  expect(rp.json()).toEqual({ error: 'billing_unconfigured' })
  await db.delete(accountSession).where(eq(accountSession.token, 'nostripesession'))
  await db.delete(account).where(eq(account.id, 'ac_bill_nostripe'))
  await app2.close()
})

test('portal: 409 not_subscribed for an account that never checked out', async () => {
  await db.insert(account).values({ id: 'ac_bill_nosub', email: 'nosub@x.test' })
  await db.insert(accountSession).values({ token: 'nosubsession', accountId: 'ac_bill_nosub', expiresAt: new Date(Date.now() + 3600_000) })
  const r = await app.inject({ method: 'POST', url: '/api/account/billing/portal', headers: { 'x-account-token': 'nosubsession' } })
  expect(r.statusCode).toBe(409)
  expect(r.json()).toEqual({ error: 'not_subscribed' })
  await db.delete(accountSession).where(eq(accountSession.token, 'nosubsession'))
  await db.delete(account).where(eq(account.id, 'ac_bill_nosub'))
})

test('checkout: concurrent requests on a fresh account create exactly one Stripe customer', async () => {
  await db.insert(account).values({ id: 'ac_bill_race', email: 'race@x.test', trialEndsAt: new Date(Date.now() + 86400_000) })
  await db.insert(accountSession).values({ token: 'racesession', accountId: 'ac_bill_race', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(sweep).values({ id: 'sw_bill_race', name: 'R1', kind: 'token', memberToken: 'rm1', adminToken: 'ra1', competitionId: COMP, accountId: 'ac_bill_race' })
  const M4 = { headers: { 'x-account-token': 'racesession' } }
  const before = stripeFake.calls.customersCreate.length
  const [r1, r2] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M4 }),
    app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M4 }),
  ])
  expect(r1.statusCode).toBe(200)
  expect(r2.statusCode).toBe(200)
  expect(stripeFake.calls.customersCreate.length - before).toBe(1) // TOCTOU fix: row lock serializes the create-or-reuse
  await db.delete(sweep).where(eq(sweep.id, 'sw_bill_race'))
  await db.delete(accountSession).where(eq(accountSession.token, 'racesession'))
  await db.delete(account).where(eq(account.id, 'ac_bill_race'))
})
