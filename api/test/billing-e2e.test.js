// api/test/billing-e2e.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import Stripe from 'stripe'
import { readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, billingEvent, catalogLeague, competition, competitor, event, ranking, sweep } from '../src/db/schema.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { activeCompetitions } from '../src/worker/active-competitions.js'
import { fakeStripe } from './helpers/fake-stripe.js'

const { pool, db } = openTestDb()
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_ID = 'apibasketball:12:2023-2024'
const WHSEC = 'whsec_e2e'
const sdk = new Stripe('sk_test_dummy')
const stripeFake = { ...fakeStripe({ subscription: { id: 'sub_e2e', status: 'active', items: { data: [{ id: 'si_e2e' }] } } }), webhooks: sdk.webhooks }
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  stripe: stripeFake, stripeWebhookSecret: WHSEC, stripePriceId: 'price_e2e',
  sendMail: async (to, subject, body) => mails.push(body),
  providerFor: () => createRecordedBasketballProvider({ leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings') }),
})
const mails = []
const webhook = (evt) => {
  const payload = JSON.stringify(evt)
  const sig = sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC })
  return app.inject({ method: 'POST', url: '/api/stripe/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': sig } })
}

beforeAll(async () => {
  await app.ready()
  await db.insert(catalogLeague).values({
    id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
    country: { name: 'USA', code: 'US', flag: null }, curated: true,
    seasons: [{ season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false }],
  }).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(billingEvent).where(inArray(billingEvent.stripeEventId, ['evt_e2e_co', 'evt_e2e_del', 'evt_e2e_renew']))
  await db.delete(sweep).where(inArray(sweep.competitionId, [NBA_ID]))
  for (const id of [NBA_ID]) {
    await db.delete(event).where(eq(event.competitionId, id))
    await db.delete(ranking).where(eq(ranking.competitionId, id))
    await db.delete(competitor).where(eq(competitor.competitionId, id))
    await db.delete(competition).where(eq(competition.id, id))
  }
  await db.delete(catalogLeague).where(eq(catalogLeague.id, 'apibasketball:12'))
  await db.delete(accountSession).where(eq(accountSession.token, 'e2esession'))
  await db.delete(account).where(eq(account.id, 'ac_e2e'))
  await app.close(); await pool.end()
})

test('trial → checkout → quantity → lapse (read-only + polling drop) → renew → archive', async () => {
  await db.insert(account).values({ id: 'ac_e2e', email: 'e2e-billing@x.test' })
  await db.insert(accountSession).values({ token: 'e2esession', accountId: 'ac_e2e', expiresAt: new Date(Date.now() + 3600_000) })
  const M = { headers: { 'x-account-token': 'e2esession' } }

  // 1. provision on trial
  const p = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'E2E', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(p.statusCode).toBe(201)
  const sweepId = p.json().id
  const [acct1] = await db.select().from(account).where(eq(account.id, 'ac_e2e'))
  expect(acct1.trialEndsAt.getTime()).toBeGreaterThan(Date.now())
  expect((await activeCompetitions(db)).map((c) => c.id)).toContain(NBA_ID)

  // 2. checkout url + completed webhook → subscribed, quantity 1
  const co = await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })
  expect(co.json().url).toContain('checkout.stripe.test')
  await webhook({ id: 'evt_e2e_co', type: 'checkout.session.completed',
    data: { object: { id: 'cs_e2e', customer: 'cus_fake1', subscription: 'sub_e2e', client_reference_id: 'ac_e2e' } } })
  const [acct2] = await db.select().from(account).where(eq(account.id, 'ac_e2e'))
  expect(acct2).toMatchObject({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_e2e', stripeSubscriptionItemId: 'si_e2e' })
  expect(stripeFake.calls.subUpdate.at(-1)).toMatchObject({ id: 'sub_e2e', items: [{ id: 'si_e2e', quantity: 1 }] })

  // 3. lapse via subscription.deleted → read-only + out of polling
  await webhook({ id: 'evt_e2e_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_e2e', status: 'canceled' } } })
  expect((await activeCompetitions(db)).map((c) => c.id)).not.toContain(NBA_ID)
  const sess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: p.json().memberToken } })
  const cookie = sess.headers['set-cookie']
  expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test', cookie } })).json().readOnly).toBe(true)
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Blocked', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).statusCode).toBe(402)

  // 4. renewal restores
  await webhook({ id: 'evt_e2e_renew', type: 'customer.subscription.updated', data: { object: { id: 'sub_e2e', status: 'active' } } })
  expect((await activeCompetitions(db)).map((c) => c.id)).toContain(NBA_ID)
  expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test', cookie } })).json().readOnly).toBe(false)

  // 5. archive decrements quantity
  stripeFake.calls.subUpdate.length = 0
  await app.inject({ method: 'POST', url: `/api/account/sweeps/${sweepId}/archive`, ...M })
  expect(stripeFake.calls.subUpdate).toEqual([{ id: 'sub_e2e', items: [{ id: 'si_e2e', quantity: 0 }], proration_behavior: 'none' }])
})
