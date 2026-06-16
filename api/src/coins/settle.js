import { and, eq } from 'drizzle-orm'
import { fixture, coinLedger, bet } from '../db/schema.js'

/** Winning selection for a final fixture: 'HOME' | 'AWAY' | 'DRAW' | null. */
export function fixtureResult(f) {
  if (f.winnerCode) {
    if (f.winnerCode === f.t1Code) return 'HOME'
    if (f.winnerCode === f.t2Code) return 'AWAY'
    return 'DRAW'
  }
  if (f.score1 == null || f.score2 == null) return null
  return f.score1 > f.score2 ? 'HOME' : f.score1 < f.score2 ? 'AWAY' : 'DRAW'
}

/**
 * Settle every OPEN bet on a finished fixture across all sweeps. Winners get a 'payout'
 * ledger row (= potentialPayout, which returns the stake too); losers keep the deducted
 * stake. Idempotent — only 'open' bets are touched. Publishes one bet-settled per sweep.
 */
export async function settleBets(db, fixtureId, publish = () => {}) {
  const [f] = await db.select().from(fixture).where(eq(fixture.id, fixtureId))
  if (!f || f.status !== 'final') return 0
  const result = fixtureResult(f)
  if (!result) return 0
  const open = await db.select().from(bet).where(and(eq(bet.fixtureId, fixtureId), eq(bet.status, 'open')))
  const sweeps = new Set()
  for (const b of open) {
    const won = b.selection === result
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
  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return open.length
}
