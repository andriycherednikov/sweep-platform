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

    // The marker insert and the handler side effects must commit atomically: if a side
    // effect throws (e.g. a Stripe API call), the transaction rolls back the marker too,
    // so Stripe's retry lands on a clean slate instead of hitting {duplicate:true} and
    // losing the event's effects forever. A throw here propagates out of the handler,
    // which Fastify turns into its default 500 — that's all Stripe's retry needs.
    return app.db.transaction(async (tx) => {
      // idempotency: the unique stripeEventId makes redelivery a visible no-op
      const inserted = await tx.insert(billingEvent)
        .values({ stripeEventId: ev.id, type: ev.type })
        .onConflictDoNothing().returning({ id: billingEvent.id })
      if (!inserted.length) return { received: true, duplicate: true }

      const obj = ev.data.object
      if (ev.type === 'checkout.session.completed') {
        const accountId = obj.client_reference_id
        if (accountId) { // no session→account link (shouldn't happen) — audit row only
          const sub = await app.stripe.subscriptions.retrieve(obj.subscription)
          await tx.update(account).set({
            stripeCustomerId: obj.customer, stripeSubscriptionId: sub.id,
            stripeSubscriptionItemId: sub.items.data[0].id, subscriptionStatus: sub.status,
          }).where(eq(account.id, accountId))
          const [acct] = await tx.select().from(account).where(eq(account.id, accountId))
          if (acct) await syncQuantity(app.stripe, acct, await liveSweepCount(tx, acct.id)) // count may have moved since session creation
          await tx.update(billingEvent).set({ accountId }).where(eq(billingEvent.stripeEventId, ev.id))
        }
      } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
        const status = ev.type.endsWith('deleted') ? 'canceled' : obj.status
        const rows = await tx.update(account).set({ subscriptionStatus: status })
          .where(eq(account.stripeSubscriptionId, obj.id)).returning({ id: account.id })
        if (rows.length) await tx.update(billingEvent).set({ accountId: rows[0].id }).where(eq(billingEvent.stripeEventId, ev.id))
      } // everything else: audit row only

      return { received: true }
    })
  })
}
