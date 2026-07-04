import { eq } from 'drizzle-orm'
import { account, billingEvent } from '../db/schema.js'
import { liveSweepCount, syncQuantity } from '../accounts/billing.js'

/** Own plugin scope: the raw-body parser below applies ONLY to routes registered here —
 *  constructEvent must see the exact request bytes, not parsed JSON. */
export async function stripeWebhookRoutes(app) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))

  app.post('/api/stripe/webhook', async (req, reply) => {
    if (!app.stripe || !app.stripeWebhookSecret) return reply.code(503).send({ error: 'billing_unconfigured' })
    let ev
    try {
      ev = app.stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], app.stripeWebhookSecret)
    } catch (e) {
      req.log.warn({ err: e }, 'stripe webhook signature rejected')
      return reply.code(400).send({ error: 'bad_signature' })
    }

    // idempotency: the unique stripeEventId makes redelivery a visible no-op
    const inserted = await app.db.insert(billingEvent)
      .values({ stripeEventId: ev.id, type: ev.type })
      .onConflictDoNothing().returning({ id: billingEvent.id })
    if (!inserted.length) return { received: true, duplicate: true }

    const obj = ev.data.object
    if (ev.type === 'checkout.session.completed') {
      const accountId = obj.client_reference_id
      const sub = await app.stripe.subscriptions.retrieve(obj.subscription)
      await app.db.update(account).set({
        stripeCustomerId: obj.customer, stripeSubscriptionId: sub.id,
        stripeSubscriptionItemId: sub.items.data[0].id, subscriptionStatus: sub.status,
      }).where(eq(account.id, accountId))
      const [acct] = await app.db.select().from(account).where(eq(account.id, accountId))
      if (acct) await syncQuantity(app.stripe, acct, await liveSweepCount(app.db, acct.id)) // count may have moved since session creation
      await app.db.update(billingEvent).set({ accountId }).where(eq(billingEvent.stripeEventId, ev.id))
    } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
      const status = ev.type.endsWith('deleted') ? 'canceled' : obj.status
      const rows = await app.db.update(account).set({ subscriptionStatus: status })
        .where(eq(account.stripeSubscriptionId, obj.id)).returning({ id: account.id })
      if (rows.length) await app.db.update(billingEvent).set({ accountId: rows[0].id }).where(eq(billingEvent.stripeEventId, ev.id))
    } // everything else: audit row only

    return { received: true }
  })
}
