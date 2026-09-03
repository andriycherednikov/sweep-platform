import { and, eq, gt, isNotNull, isNull, lt, notInArray } from 'drizzle-orm'
import { account, sweep } from '../db/schema.js'
import { endedCompetitionIds } from '../season.js'

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

/** Billable sweeps = unarchived, on a competition that still has something to play.
 *  (Lapse doesn't shrink what renewing would bill — but a season that is over does.
 *  Charging for a finished competition is a refund dispute waiting to happen, and the
 *  sweep is deliberately left unarchived: the customer keeps seeing it, they just stop
 *  paying for it.) */
export async function liveSweepCount(db, accountId, now = new Date()) {
  const ended = await endedCompetitionIds(db, now)
  const rows = await db.select({ id: sweep.id }).from(sweep)
    .where(and(
      eq(sweep.accountId, accountId),
      isNull(sweep.archivedAt),
      ...(ended.length ? [notInArray(sweep.competitionId, ended)] : []),
    ))
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

/**
 * Daily: re-assert every subscribed account's quantity against what is actually running.
 *
 * syncQuantity is only called when something changes — a sweep provisioned, a sweep
 * archived. A season ending is not an event anybody fires, so without this a customer
 * whose league finished in May would keep being billed for it until they touched
 * something. Idempotent by design: it sets a COUNT, so a no-op costs one Stripe call.
 *
 * Floored at 1 on purpose. Dropping an account's last running sweep to quantity 0 means
 * deciding to stop charging them altogether, and cancelling somebody's subscription
 * without being asked is not a call this loop should make on its own. Those accounts are
 * returned so the operator can see them.
 */
export async function reassertQuantities(db, stripe, now = new Date()) {
  if (!stripe) return { updated: 0, payingForNothing: [] }
  const accounts = await db.select().from(account)
    .where(and(isNotNull(account.stripeSubscriptionId), isNotNull(account.stripeSubscriptionItemId)))
  const payingForNothing = []
  let updated = 0
  for (const a of accounts) {
    const count = await liveSweepCount(db, a.id, now)
    if (count === 0) payingForNothing.push(a.id)
    try {
      await syncQuantity(stripe, a, Math.max(1, count))
      updated++
    } catch (e) {
      console.error(`[billing] quantity re-assert failed for ${a.id}:`, e.message)
    }
  }
  return { updated, payingForNothing }
}

const REMIND_WINDOW_MS = 3 * 24 * 3600_000
const consoleMail = async (to, subject, body) => console.log(`[mail] to=${to} subject=${subject}\n${body}`)

/** Daily (worker): one heads-up mail per account, ~3 days before the cardless trial ends. */
export async function sendTrialReminders(db, sendMail = consoleMail, now = new Date()) {
  const soon = new Date(now.getTime() + REMIND_WINDOW_MS)
  const due = await db.select().from(account).where(and(
    isNull(account.subscriptionStatus), isNull(account.trialReminderSentAt),
    isNotNull(account.trialEndsAt), gt(account.trialEndsAt, now), lt(account.trialEndsAt, soon),
  ))
  for (const acct of due) {
    await sendMail(acct.email, 'Your sweep trial is ending soon',
      `Your trial ends ${acct.trialEndsAt.toISOString().slice(0, 10)}. Add a card to keep your sweeps running (POST /api/account/billing/checkout).`)
    await db.update(account).set({ trialReminderSentAt: now }).where(eq(account.id, acct.id))
  }
  return due.length
}

/** What a Stripe subscription says about its own end. `current_period_end` moved onto
 *  the items in recent API versions, so read either — an account that cannot say when
 *  a cancelled subscription stops is worse than one that shows nothing. */
export function renewalOf(sub) {
  const secs = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null
  return {
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    currentPeriodEnd: secs ? new Date(secs * 1000) : null,
  }
}
