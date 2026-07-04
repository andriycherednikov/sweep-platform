import { and, eq } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { bet, event, parlay } from '../db/schema.js'
import { flattenEvent } from '../db/event-shape.js'
import { resolveBet, settleBets } from './settle.js'

/**
 * One-off remediation for goalscorer bets mis-settled as 'lost' before the surname+initial
 * name match (the odds feed says "Erling Haaland", the events feed says "E. Haaland", so the
 * old exact-string match never fired). Finds every final-fixture 'gs' bet currently 'lost'
 * that now grades 'won', resets it — and any parlay it belongs to — back to 'open', then
 * re-runs the idempotent settler so winners get their payout and parlays roll up correctly.
 *
 * Safe to re-run: once a bet flips to 'won' it's no longer selected, and a reset bet left
 * 'open' by an interrupted run is caught by the next settle (settleBets/settleStaleBets).
 */
export async function regradeGs(db, publish = () => {}) {
  const rows = await db.select({ b: bet, f: event })
    .from(bet).innerJoin(event, eq(bet.fixtureId, event.id))
    .where(and(eq(bet.market, 'gs'), eq(bet.status, 'lost'), eq(event.status, 'final')))

  const flips = rows.filter(({ b, f }) =>
    resolveBet('gs', b.selection, b.line == null ? null : Number(b.line), flattenEvent(f)) === 'won')
  if (flips.length === 0) return { regraded: 0, fixtures: 0 }

  // Reset the mis-graded legs (and their parent parlays) to 'open' so the settler re-grades
  // them. A parlay that was only lost because of this leg becomes winnable again.
  const fixtureIds = new Set()
  const parlayIds = new Set()
  for (const { b } of flips) {
    await db.update(bet).set({ status: 'open', settledAt: null }).where(eq(bet.id, b.id))
    fixtureIds.add(b.fixtureId)
    if (b.parlayId) parlayIds.add(b.parlayId)
  }
  for (const pid of parlayIds) {
    await db.update(parlay).set({ status: 'open', settledAt: null }).where(eq(parlay.id, pid))
  }

  // Re-settle each affected fixture through the vetted, idempotent path: settleBets re-grades
  // open bets, pays standalone winners, and rolls up any parlay whose legs are now all graded.
  for (const fid of fixtureIds) await settleBets(db, fid, publish)
  return { regraded: flips.length, fixtures: fixtureIds.size, parlays: parlayIds.size }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  const summary = await regradeGs(createDb(pool))
  await pool.end()
  console.log(`regrade-gs: re-graded ${summary.regraded} bet(s) across ${summary.fixtures} fixture(s), ${summary.parlays ?? 0} parlay(s) reopened`)
}
