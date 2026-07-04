import { and, eq } from 'drizzle-orm'
import { event, person, support, ownership, coinLedger } from '../db/schema.js'
import { flattenEvent } from '../db/event-shape.js'
import { fixtureResult } from './settle.js'
import { PREDICT_REWARD, TEAM_WIN_REWARD } from './constants.js'
import { codeToCompetitorId } from '../routes/competitors.js'

/**
 * For a final fixture, grant:
 *  - +PREDICT_REWARD to each person whose support pick matches the result;
 *  - +TEAM_WIN_REWARD to each owner of the winning team (no payout on a draw).
 * Both keyed by refId = fixtureId, inserted with onConflictDoNothing() so the
 * coin_ledger (sweepId, personId, type, refId) unique constraint makes re-runs no-ops.
 * Returns the number of NEW reward rows granted. Publishes one 'bet-settled' per touched
 * sweep (the web client invalidates the coins cache on it).
 */
export async function grantMatchRewards(db, fixtureId, publish = () => {}) {
  const [row] = await db.select().from(event).where(eq(event.id, fixtureId))
  const f = row && flattenEvent(row)
  if (!f || f.status !== 'final') return 0
  const result = fixtureResult(f) // 'HOME' | 'AWAY' | 'DRAW' | null
  if (!result) return 0

  const sweeps = new Set()
  let granted = 0

  // (a) correct predictions → +100
  const picks = await db.select({ sweepId: support.sweepId, personId: support.personId, teamCode: support.teamCode, adult: person.adult })
    .from(support)
    .innerJoin(person, and(eq(person.id, support.personId), eq(person.sweepId, support.sweepId)))
    .where(eq(support.fixtureId, fixtureId))
  for (const s of picks) {
    if (s.adult === false) continue // coins is 18+ — no rewards for minors
    const pick = s.teamCode === 'DRAW' ? 'DRAW'
      : s.teamCode === f.t1Code ? 'HOME'
      : s.teamCode === f.t2Code ? 'AWAY'
      : null
    if (pick !== result) continue
    const ins = await db.insert(coinLedger)
      .values({ sweepId: s.sweepId, personId: s.personId, type: 'predict', amount: PREDICT_REWARD, refId: fixtureId })
      .onConflictDoNothing()
      .returning({ id: coinLedger.id })
    if (ins.length) { granted++; sweeps.add(s.sweepId) }
  }

  // (b) owned winning team → +300 per owner (no winner on a draw)
  if (result !== 'DRAW') {
    const winningTeam = result === 'HOME' ? f.t1Code : f.t2Code
    // rewards is cross-sweep: resolve the code via the EVENT's own competition, not a request sweep.
    // Competitor ids are namespaced as cp_{competitionId}_{code}, so ownership rows across sweeps
    // (each possibly bound to a different competition, later) still filter correctly by id alone.
    const winningCompetitorId = await codeToCompetitorId(db, row.competitionId, winningTeam)
    const owners = winningCompetitorId ? await db.select({ sweepId: ownership.sweepId, personId: ownership.personId, adult: person.adult })
      .from(ownership)
      .innerJoin(person, and(eq(person.id, ownership.personId), eq(person.sweepId, ownership.sweepId)))
      .where(eq(ownership.competitorId, winningCompetitorId)) : []
    for (const o of owners) {
      if (o.adult === false) continue // coins is 18+ — no rewards for minors
      const ins = await db.insert(coinLedger)
        .values({ sweepId: o.sweepId, personId: o.personId, type: 'teamwin', amount: TEAM_WIN_REWARD, refId: fixtureId })
        .onConflictDoNothing()
        .returning({ id: coinLedger.id })
      if (ins.length) { granted++; sweeps.add(o.sweepId) }
    }
  }

  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return granted
}
