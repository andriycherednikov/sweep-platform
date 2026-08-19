import { eq } from 'drizzle-orm'
import { account } from '../db/schema.js'
import { requireAccount } from '../accounts/auth.js'
import { GOOD_STANDING, liveSweepCount, syncQuantity } from '../accounts/billing.js'

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
      let customerId = acct.stripeCustomerId
      if (!customerId) {
        const c = await app.stripe.customers.create({ email: acct.email, metadata: { accountId: acct.id } })
        customerId = c.id
        await tx.update(account).set({ stripeCustomerId: customerId }).where(eq(account.id, acct.id))
      }
      const sess = await app.stripe.checkout.sessions.create({
        mode: 'subscription', customer: customerId, client_reference_id: acct.id,
        // A zero-sweep account (trial-expired-and-let-lapse, or archived-out) must still be able
        // to re-subscribe — Stripe requires quantity ≥ 1, and the completed webhook re-asserts
        // the true live count anyway, so paying for one seat until they provision is fine.
        line_items: [{ price: app.stripePriceId, quantity: Math.max(n, 1) }],
        success_url: `https://${app.platformHost}/account/billing/success?session_id={CHECKOUT_SESSION_ID}`,
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

  const statusOf = async (db, acct) => {
    const liveSweeps = await liveSweepCount(db, acct.id)
    const subscribed = GOOD_STANDING.includes(acct.subscriptionStatus)
    return { subscribed, subscriptionStatus: acct.subscriptionStatus, trialEndsAt: acct.trialEndsAt, liveSweeps, quantity: subscribed ? liveSweeps : 0 }
  }

  app.get('/api/account/billing', { preHandler: accountGuard }, async (req) => {
    const [acct] = await app.db.select().from(account).where(eq(account.id, req.account.id))
    return statusOf(app.db, acct)
  })

  /** Coming back from checkout proves nothing on its own — the redirect is just a URL
   *  the browser was handed. Ask Stripe what happened to that session and reconcile
   *  from the answer, so the owner sees the truth without waiting on the webhook
   *  (which stays the authority for everything after this moment). */
  app.post('/api/account/billing/confirm', {
    preHandler: accountGuard, config: limited,
    schema: { body: { type: 'object', required: ['sessionId'], additionalProperties: false,
      properties: { sessionId: { type: 'string', minLength: 8, maxLength: 200 } } } },
  }, async (req, reply) => {
    if (!app.stripe) return reply.code(503).send({ error: 'billing_unconfigured' })
    let sess
    try { sess = await app.stripe.checkout.sessions.retrieve(req.body.sessionId) }
    catch (err) {
      req.log.warn({ err }, 'checkout session lookup failed')
      return reply.code(404).send({ error: 'unknown_session' })
    }
    // someone else's session must never activate this account
    if (sess?.client_reference_id !== req.account.id) return reply.code(404).send({ error: 'unknown_session' })

    const paid = sess.status === 'complete' && ['paid', 'no_payment_required'].includes(sess.payment_status)
    const result = await app.db.transaction(async (tx) => {
      const [acct] = await tx.select().from(account).where(eq(account.id, req.account.id)).for('update')
      if (!paid || !sess.subscription) return statusOf(tx, acct)   // still processing: report, change nothing
      const sub = await app.stripe.subscriptions.retrieve(sess.subscription)
      await tx.update(account).set({
        stripeCustomerId: sess.customer, stripeSubscriptionId: sub.id,
        stripeSubscriptionItemId: sub.items.data[0].id, subscriptionStatus: sub.status,
      }).where(eq(account.id, acct.id))
      const [fresh] = await tx.select().from(account).where(eq(account.id, acct.id))
      await syncQuantity(app.stripe, fresh, await liveSweepCount(tx, fresh.id))
      return statusOf(tx, fresh)
    })
    return result
  })
}
