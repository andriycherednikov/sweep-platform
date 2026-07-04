import { eq } from 'drizzle-orm'
import { account } from '../db/schema.js'
import { requireAccount } from '../accounts/auth.js'
import { GOOD_STANDING, liveSweepCount } from '../accounts/billing.js'

/** Owner-facing billing surface (decision c: API-only — Stripe hosts every page we'd otherwise build). */
export async function billingRoutes(app) {
  const accountGuard = requireAccount(app)
  const limited = { rateLimit: { max: 10, timeWindow: '15 minutes' } }

  app.post('/api/account/billing/checkout', { preHandler: accountGuard, config: limited }, async (req, reply) => {
    if (!app.stripe) return reply.code(503).send({ error: 'billing_unconfigured' })
    // Same idiom as provision/archive: lock the account row so two near-simultaneous
    // checkouts can't both see stripeCustomerId null and both create a Stripe customer.
    const result = await app.db.transaction(async (tx) => {
      const [acct] = await tx.select().from(account).where(eq(account.id, req.account.id)).for('update')
      if (GOOD_STANDING.includes(acct.subscriptionStatus)) return { code: 409, body: { error: 'already_subscribed' } }
      const n = await liveSweepCount(tx, acct.id)
      if (!n) return { code: 409, body: { error: 'no_live_sweeps' } } // Stripe requires quantity ≥ 1
      let customerId = acct.stripeCustomerId
      if (!customerId) {
        const c = await app.stripe.customers.create({ email: acct.email, metadata: { accountId: acct.id } })
        customerId = c.id
        await tx.update(account).set({ stripeCustomerId: customerId }).where(eq(account.id, acct.id))
      }
      const sess = await app.stripe.checkout.sessions.create({
        mode: 'subscription', customer: customerId, client_reference_id: acct.id,
        line_items: [{ price: app.stripePriceId, quantity: n }],
        success_url: `https://${app.platformHost}/account/billing/success`,
        cancel_url: `https://${app.platformHost}/account/billing/cancelled`,
      })
      return { code: 200, body: { url: sess.url } }
    })
    return reply.code(result.code).send(result.body)
  })

  app.post('/api/account/billing/portal', { preHandler: accountGuard, config: limited }, async (req, reply) => {
    if (!app.stripe) return reply.code(503).send({ error: 'billing_unconfigured' })
    const [acct] = await app.db.select().from(account).where(eq(account.id, req.account.id))
    if (!acct.stripeCustomerId) return reply.code(409).send({ error: 'not_subscribed' })
    const sess = await app.stripe.billingPortal.sessions.create({
      customer: acct.stripeCustomerId, return_url: `https://${app.platformHost}/account`,
    })
    return { url: sess.url }
  })

  app.get('/api/account/billing', { preHandler: accountGuard }, async (req) => {
    const [acct] = await app.db.select().from(account).where(eq(account.id, req.account.id))
    const liveSweeps = await liveSweepCount(app.db, acct.id)
    const subscribed = GOOD_STANDING.includes(acct.subscriptionStatus)
    return { subscribed, subscriptionStatus: acct.subscriptionStatus, trialEndsAt: acct.trialEndsAt, liveSweeps, quantity: subscribed ? liveSweeps : 0 }
  })
}
