import { and, eq } from 'drizzle-orm'
import { event, coinLedger, bet, parlay, competition } from '../db/schema.js'
import { flattenEvent } from '../db/event-shape.js'
import { resolveBet, fixtureResult, regulationResult } from './markets.js'
import { sportConfig } from '../sports.js'

export { resolveBet, fixtureResult, regulationResult, MARKET_REGISTRY } from './markets.js'

/**
 * Settle every OPEN bet on a finished fixture across all sweeps. Winners get a 'payout'
 * ledger row (= potentialPayout, which returns the stake too); losers keep the deducted
 * stake. Idempotent — only 'open' bets are touched. Publishes one bet-settled per sweep.
 */
export async function settleBets(db, fixtureId, publish = () => {}) {
  const [row] = await db.select().from(event).where(eq(event.id, fixtureId))
  const f = row && flattenEvent(row)
  if (!f || f.status !== 'final') return 0
  const [comp] = await db.select().from(competition).where(eq(competition.id, row.competitionId))
  const sport = sportConfig(comp.sport)
  const open = await db.select().from(bet).where(and(eq(bet.fixtureId, fixtureId), eq(bet.status, 'open')))
  const sweeps = new Set()
  const parlayIds = new Set()
  for (const b of open) {
    const outcome = resolveBet(b.market, b.selection, b.line == null ? null : Number(b.line), f, sport)
    if (outcome == null) continue // data not available yet → leave open
    const won = outcome === 'won'
    if (b.parlayId) {
      // a parlay leg never pays on its own — grade it (guarded), then let settleParlay
      // roll the accumulator up once all its legs are graded. The parent owns the money.
      const claimed = await db.update(bet).set({ status: won ? 'won' : 'lost', settledAt: new Date() })
        .where(and(eq(bet.id, b.id), eq(bet.status, 'open'))).returning({ id: bet.id })
      if (claimed.length) parlayIds.add(b.parlayId)
      continue
    }
    const settled = await db.transaction(async (tx) => {
      // claim the bet atomically: the conditional update wins exactly once, so a concurrent
      // settle of the same fixture finds 0 rows and skips the payout (no double-pay, no crash).
      const claimed = await tx.update(bet).set({ status: won ? 'won' : 'lost', settledAt: new Date() })
        .where(and(eq(bet.id, b.id), eq(bet.status, 'open'))).returning({ id: bet.id })
      if (claimed.length === 0) return false
      if (won) await tx.insert(coinLedger).values({ sweepId: b.sweepId, personId: b.personId, type: 'payout', amount: b.potentialPayout, refId: b.id })
      return true
    })
    if (settled) sweeps.add(b.sweepId)
  }
  for (const pid of parlayIds) { const sw = await settleParlay(db, pid); if (sw) sweeps.add(sw) }
  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return open.length
}

/**
 * Roll up a parlay once a leg has been graded. LOST the moment ANY leg loses; WON (pay
 * stake×combinedOdds once, via potentialPayout) only when EVERY leg has won; otherwise
 * leave it open so a later fixture's settleBets retriggers this. Idempotent: the guarded
 * status UPDATE flips open→won/lost exactly once and the payout is onConflictDoNothing.
 * Returns the parlay's sweepId when it just settled (for the caller to publish), else null.
 */
export async function settleParlay(db, parlayId) {
  const [pl] = await db.select().from(parlay).where(eq(parlay.id, parlayId))
  if (!pl || pl.status !== 'open') return null
  const legs = await db.select().from(bet).where(eq(bet.parlayId, parlayId))
  const anyLost = legs.some((l) => l.status === 'lost')
  const allWon = legs.length > 0 && legs.every((l) => l.status === 'won')
  if (!anyLost && !allWon) return null
  const status = anyLost ? 'lost' : 'won'
  const claimed = await db.update(parlay).set({ status, settledAt: new Date() })
    .where(and(eq(parlay.id, parlayId), eq(parlay.status, 'open'))).returning({ id: parlay.id })
  if (claimed.length === 0) return null
  if (status === 'won') {
    await db.insert(coinLedger)
      .values({ sweepId: pl.sweepId, personId: pl.personId, type: 'payout', amount: pl.potentialPayout, refId: pl.id })
      .onConflictDoNothing()
  }
  return pl.sweepId
}

/**
 * Safety net for stale bets: settle every OPEN bet whose fixture is already 'final'
 * but was never graded — e.g. the worker was down, the live-poll window missed the
 * transition, or result data arrived late. Reuses the idempotent per-fixture
 * settleBets, so it's safe to run repeatedly. Returns the number of fixtures swept.
 */
export async function settleStaleBets(db, publish = () => {}) {
  const rows = await db.select({ fixtureId: bet.fixtureId })
    .from(bet).innerJoin(event, eq(bet.fixtureId, event.id))
    .where(and(eq(bet.status, 'open'), eq(event.status, 'final')))
  const ids = [...new Set(rows.map((r) => r.fixtureId))]
  for (const id of ids) await settleBets(db, id, publish)
  // roll up any open parlay whose legs are already graded but the parent never settled —
  // settleParlay is a no-op while still pending, so this is safe to run every sweep.
  const openParlays = await db.select({ id: parlay.id }).from(parlay).where(eq(parlay.status, 'open'))
  const sweeps = new Set()
  for (const { id } of openParlays) { const sw = await settleParlay(db, id); if (sw) sweeps.add(sw) }
  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return ids.length
}
