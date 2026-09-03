import { and, eq, gt, inArray, isNull, notInArray, or } from 'drizzle-orm'
import { account, competition, sweep } from '../db/schema.js'
import { GOOD_STANDING } from '../accounts/billing.js'
import { endedCompetitionIds } from '../season.js'

/** Competitions worth syncing: bound to ≥1 LIVE sweep — unarchived AND
 *  (ops-owned OR paid-in-good-standing OR never-subscribed-and-in-trial).
 *  The §7 dedupe holds: a competition leaves polling only when NO live sweep
 *  remains on it. Lapsed sweeps cost zero feed (econ note §6.1).
 *  Empty DB → empty list → worker loops no-op instead of crashing on boot.
 *  A competition whose season is over is dropped whatever its sweeps are paying:
 *  there is nothing left to poll, and it used to poll forever. */
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
  const ended = await endedCompetitionIds(db, now)
  const where = ended.length
    ? and(inArray(competition.id, ids), notInArray(competition.id, ended))
    : inArray(competition.id, ids)
  return db.select().from(competition).where(where)
}
