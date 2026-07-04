import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import { account, competition, sweep } from '../db/schema.js'
import { GOOD_STANDING } from '../accounts/billing.js'

/** Competitions worth syncing: bound to ≥1 LIVE sweep — unarchived AND
 *  (ops-owned OR paid-in-good-standing OR never-subscribed-and-in-trial).
 *  The §7 dedupe holds: a competition leaves polling only when NO live sweep
 *  remains on it. Lapsed sweeps cost zero feed (econ note §6.1).
 *  Empty DB → empty list → worker loops no-op instead of crashing on boot. */
export async function activeCompetitions(db, now = new Date()) {
  const rows = await db.selectDistinct({ id: sweep.competitionId }).from(sweep)
    .leftJoin(account, eq(sweep.accountId, account.id))
    .where(and(
      isNull(sweep.archivedAt),
      or(
        isNull(sweep.accountId),
        inArray(account.subscriptionStatus, GOOD_STANDING),
        and(isNull(account.subscriptionStatus), gt(account.trialEndsAt, now)),
      ),
    ))
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (!ids.length) return []
  return db.select().from(competition).where(inArray(competition.id, ids))
}
