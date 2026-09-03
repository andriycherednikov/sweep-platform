import { sql } from 'drizzle-orm'
import { event } from './db/schema.js'

/**
 * How long after the last fixture a competition is still treated as running.
 *
 * The fixture list is the only thing that knows a season is over — `competition` carries
 * no end date, and the catalog's is about what may be provisioned, not about what we
 * actually hold. Deriving it from fixtures is truthful but has one failure mode: a
 * fixture list the feed has not finished delivering looks exactly like a finished season.
 * The grace window is the guard. Two weeks is long enough to cover a postponement that
 * has not been rescheduled yet, and short enough that nobody pays for a dead sweep for
 * more than one extra fortnight.
 */
export const GRACE_MS = 14 * 24 * 3600_000

/**
 * Competition ids with nothing left to play: every fixture final, and the last of them
 * kicked off longer ago than the grace window.
 *
 * A competition with no fixtures at all is deliberately absent — it has not started, not
 * finished, and a sweep provisioned seconds ago must not stop syncing before its first
 * fill lands. GROUP BY gives that for free: no rows, no group, no verdict.
 */
export async function endedCompetitionIds(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - GRACE_MS)
  const rows = await db
    .select({ id: event.competitionId })
    .from(event)
    .groupBy(event.competitionId)
    .having(sql`bool_and(${event.status} = 'final') and max(${event.startUtc}) < ${cutoff}`)
  return rows.map((r) => r.id)
}
