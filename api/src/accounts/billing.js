import { and, eq, isNull } from 'drizzle-orm'
import { account, sweep } from '../db/schema.js'

export const TRIAL_MS = 14 * 24 * 3600_000 // one cardless trial per account, started at first provision
export const GOOD_STANDING = ['active', 'past_due'] // past_due = Stripe dunning grace; unpaid/canceled = lapsed

/** THE liveness rule (design §3). Derived, never materialized:
 *  live = not archived AND (ops-owned OR paid-in-good-standing OR never-subscribed-and-in-trial). */
export function sweepIsLive(sweepRow, accountRow, now = new Date()) {
  if (sweepRow.archivedAt) return false
  if (!sweepRow.accountId) return true // ops sweep (WC default, super-created) — exempt by owner decision
  if (!accountRow) return false
  if (GOOD_STANDING.includes(accountRow.subscriptionStatus)) return true
  return !accountRow.subscriptionStatus && !!accountRow.trialEndsAt && accountRow.trialEndsAt > now
}

/** Request-time convenience: resolve the owning account (if any) and apply the rule. */
export async function sweepLiveNow(app, sweepRow) {
  if (!sweepRow?.accountId) return true
  const [acct] = await app.db.select().from(account).where(eq(account.id, sweepRow.accountId))
  return sweepIsLive(sweepRow, acct)
}

/** Billable sweeps = unarchived. (Lapse doesn't shrink what renewing would bill.) */
export async function liveSweepCount(db, accountId) {
  const rows = await db.select({ id: sweep.id }).from(sweep)
    .where(and(eq(sweep.accountId, accountId), isNull(sweep.archivedAt)))
  return rows.length
}

/** Re-assert subscription quantity as a COUNT (not an increment) — a missed sync self-heals
 *  at the next change. proration 'none': no penny prorations at $5. No-op pre-subscription. */
export async function syncQuantity(stripe, accountRow, quantity) {
  if (!accountRow.stripeSubscriptionId || !accountRow.stripeSubscriptionItemId) return
  await stripe.subscriptions.update(accountRow.stripeSubscriptionId, {
    items: [{ id: accountRow.stripeSubscriptionItemId, quantity }],
    proration_behavior: 'none',
  })
}
