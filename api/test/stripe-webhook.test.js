import { test, expect, beforeAll, afterAll } from 'vitest'
import Stripe from 'stripe'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, billingEvent, competition, sweep } from '../src/db/schema.js'
import { fakeStripe } from './helpers/fake-stripe.js'

const { pool, db } = openTestDb()
const WHSEC = 'whsec_testsecret'
const sdk = new Stripe('sk_test_dummy') // offline: only .webhooks is used
// hybrid: fake API surface + REAL signature verification
const stripeFake = { ...fakeStripe(), webhooks: sdk.webhooks }
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', stripe: stripeFake, stripeWebhookSecret: WHSEC })
const COMP = 'apibasketball:12:webhook'

const send = (event) => {
  const payload = JSON.stringify(event)
  const sig = sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC })
  return app.inject({ method: 'POST', url: '/api/stripe/webhook', payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': sig } })
}

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_wh', email: 'wh@x.test', stripeCustomerId: 'cus_wh' })
  await db.insert(competition).values({ id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'webhook', format: 'league', name: 'W' }).onConflictDoNothing()
  await db.insert(sweep).values({ id: 'sw_wh_1', name: 'W1', kind: 'token', memberToken: 'wm1', adminToken: 'wa1', competitionId: COMP, accountId: 'ac_wh' })
})
afterAll(async () => {
  await db.delete(billingEvent).where(inArray(billingEvent.stripeEventId, ['evt_co_1', 'evt_up_1', 'evt_del_1', 'evt_odd_1']))
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_wh'))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(account).where(eq(account.id, 'ac_wh'))
  await app.close(); await pool.end()
})

test('bad signature → 400; nothing recorded', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/stripe/webhook', payload: '{}',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=garbage' } })
  expect(res.statusCode).toBe(400)
  expect(await db.select().from(billingEvent)).toHaveLength(0)
})

test('checkout.session.completed stores ids + status and re-syncs quantity; replay is a no-op', async () => {
  const ev = { id: 'evt_co_1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', customer: 'cus_wh', subscription: 'sub_wh_1', client_reference_id: 'ac_wh' } } }
  expect((await send(ev)).statusCode).toBe(200)
  const [acct] = await db.select().from(account).where(eq(account.id, 'ac_wh'))
  expect(acct).toMatchObject({ stripeSubscriptionId: 'sub_wh_1', stripeSubscriptionItemId: 'si_fake1', subscriptionStatus: 'active' })
  expect(stripeFake.calls.subUpdate.at(-1)).toMatchObject({ id: 'sub_wh_1', items: [{ id: 'si_fake1', quantity: 1 }] })

  const replay = await send(ev)
  expect(replay.json()).toMatchObject({ received: true, duplicate: true })
  expect(await db.select().from(billingEvent).where(eq(billingEvent.stripeEventId, 'evt_co_1'))).toHaveLength(1)
})

test('subscription.updated mirrors status; deleted lapses; unknown type is audit-only', async () => {
  await send({ id: 'evt_up_1', type: 'customer.subscription.updated', data: { object: { id: 'sub_wh_1', status: 'past_due' } } })
  expect((await db.select().from(account).where(eq(account.id, 'ac_wh')))[0].subscriptionStatus).toBe('past_due')

  await send({ id: 'evt_del_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_wh_1', status: 'canceled' } } })
  expect((await db.select().from(account).where(eq(account.id, 'ac_wh')))[0].subscriptionStatus).toBe('canceled')

  expect((await send({ id: 'evt_odd_1', type: 'invoice.payment_failed', data: { object: { id: 'in_1' } } })).statusCode).toBe(200)
  const rows = await db.select().from(billingEvent)
  expect(rows.map((r) => r.stripeEventId).sort()).toEqual(['evt_co_1', 'evt_del_1', 'evt_odd_1', 'evt_up_1'])
})
