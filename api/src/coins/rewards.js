import { and, eq } from 'drizzle-orm'
import { fixture, person, support, ownership, coinLedger } from '../db/schema.js'
import { fixtureResult } from './settle.js'
import { PREDICT_REWARD, TEAM_WIN_REWARD } from './constants.js'

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
  const [f] = await db.select().from(fixture).where(eq(fixture.id, fixtureId))
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
    const owners = await db.select({ sweepId: ownership.sweepId, personId: ownership.personId, adult: person.adult })
      .from(ownership)
      .innerJoin(person, and(eq(person.id, ownership.personId), eq(person.sweepId, ownership.sweepId)))
      .where(eq(ownership.teamCode, winningTeam))
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
