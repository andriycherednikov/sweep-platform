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

function htResult(f) {
  let h = f.htScore1, a = f.htScore2
  if (h == null || a == null) {
    if (!Array.isArray(f.events)) return null // never polled — can't know the HT score
    const fh = f.events.filter((e) => e.type === 'goal' && (e.minute ?? 99) <= 45)
    h = fh.filter((e) => e.teamCode === f.t1Code).length
    a = fh.filter((e) => e.teamCode === f.t2Code).length
  }
  return h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW'
}

/** Regulation-time (90') winning side from the stored 90-minute score. Used for bet
 *  settlement so a knockout decided in ET/penalties still grades on its 90' result. */
export function regulationResult(f) {
  if (f.regScore1 == null || f.regScore2 == null) return null
  return f.regScore1 > f.regScore2 ? 'HOME' : f.regScore1 < f.regScore2 ? 'AWAY' : 'DRAW'
}

/** Resolve one bet → 'won' | 'lost' | null (null = data not available yet, leave open). */
export function resolveBet(market, selection, line, f) {
  if (market === '1x2') { const r = regulationResult(f); return r == null ? null : r === selection ? 'won' : 'lost' }
  if (market === 'fh1x2') { const r = htResult(f); return r == null ? null : r === selection ? 'won' : 'lost' }
  if (market === 'ou25' || market === 'cards') {
    if (line == null) return null
    let measure
    if (market === 'ou25') { if (f.regScore1 == null || f.regScore2 == null) return null; measure = f.regScore1 + f.regScore2 }
    else { if (!Array.isArray(f.events)) return null; measure = f.events.filter((e) => e.type === 'card' && (e.minute ?? 0) <= 90).length }
    const over = measure > line
    return (selection === 'OVER' ? over : !over) ? 'won' : 'lost'
  }
  if (market === 'cs') { if (f.regScore1 == null || f.regScore2 == null) return null; return `${f.regScore1}:${f.regScore2}` === selection ? 'won' : 'lost' }
  return null
}

/**
 * Settle every OPEN bet on a finished fixture across all sweeps. Winners get a 'payout'
 * ledger row (= potentialPayout, which returns the stake too); losers keep the deducted
 * stake. Idempotent — only 'open' bets are touched. Publishes one bet-settled per sweep.
 */
export async function settleBets(db, fixtureId, publish = () => {}) {
  const [f] = await db.select().from(fixture).where(eq(fixture.id, fixtureId))
  if (!f || f.status !== 'final') return 0
  const open = await db.select().from(bet).where(and(eq(bet.fixtureId, fixtureId), eq(bet.status, 'open')))
  const sweeps = new Set()
  for (const b of open) {
    const outcome = resolveBet(b.market, b.selection, b.line == null ? null : Number(b.line), f)
    if (outcome == null) continue // data not available yet → leave open
    const won = outcome === 'won'
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

/**
 * Safety net for stale bets: settle every OPEN bet whose fixture is already 'final'
 * but was never graded — e.g. the worker was down, the live-poll window missed the
 * transition, or result data arrived late. Reuses the idempotent per-fixture
 * settleBets, so it's safe to run repeatedly. Returns the number of fixtures swept.
 */
export async function settleStaleBets(db, publish = () => {}) {
  const rows = await db.select({ fixtureId: bet.fixtureId })
    .from(bet).innerJoin(fixture, eq(bet.fixtureId, fixture.id))
    .where(and(eq(bet.status, 'open'), eq(fixture.status, 'final')))
  const ids = [...new Set(rows.map((r) => r.fixtureId))]
  for (const id of ids) await settleBets(db, id, publish)
  return ids.length
}
