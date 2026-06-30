import { and, eq } from 'drizzle-orm'
import { fixture, coinLedger, bet, parlay } from '../db/schema.js'

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

/** Half-time [home, away] goals from the stored HT score, falling back to counting goal
 *  events at minute <= 45. null when neither is available (events never polled). */
function htScores(f) {
  let h = f.htScore1, a = f.htScore2
  if (h == null || a == null) {
    if (!Array.isArray(f.events)) return null // never polled — can't know the HT score
    const fh = f.events.filter((e) => e.type === 'goal' && (e.minute ?? 99) <= 45)
    h = fh.filter((e) => e.teamCode === f.t1Code).length
    a = fh.filter((e) => e.teamCode === f.t2Code).length
  }
  return [h, a]
}
function htResult(f) {
  const s = htScores(f); if (!s) return null
  const [h, a] = s
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
  // To Qualify grades on who actually advanced (winnerCode → ET/penalties aware), not the 90' result.
  if (market === 'toq') { const r = fixtureResult(f); return r == null ? null : r === selection ? 'won' : 'lost' }
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
  if (market === 'btts') {
    if (f.regScore1 == null || f.regScore2 == null) return null
    const yes = f.regScore1 > 0 && f.regScore2 > 0
    return (selection === 'YES' ? yes : !yes) ? 'won' : 'lost'
  }
  if (market === 'dc') {
    const r = regulationResult(f); if (r == null) return null
    const pair = { '1X': ['HOME', 'DRAW'], '12': ['HOME', 'AWAY'], 'X2': ['DRAW', 'AWAY'] }[selection]
    return pair && pair.includes(r) ? 'won' : 'lost'
  }
  if (market === 'oe') {
    if (f.regScore1 == null || f.regScore2 == null) return null
    const even = (f.regScore1 + f.regScore2) % 2 === 0
    return (selection === 'EVEN' ? even : !even) ? 'won' : 'lost'
  }
  if (market === 'fhou') {
    if (line == null) return null
    const s = htScores(f); if (!s) return null
    const over = (s[0] + s[1]) > line
    return (selection === 'OVER' ? over : !over) ? 'won' : 'lost'
  }
  if (market === 'gs') {
    if (!Array.isArray(f.events)) return null // events not polled yet → leave open
    // v1 "all bets stand": won iff the named player scored a non-own goal in regulation;
    // otherwise lost (no DNP void). Match on a normalised name (both sides are API-Football).
    const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
    const target = norm(selection)
    const scored = f.events.some((e) => e.type === 'goal' && e.detail !== 'Own Goal' && (e.minute ?? 0) <= 90 && norm(e.player) === target)
    return scored ? 'won' : 'lost'
  }
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
  const parlayIds = new Set()
  for (const b of open) {
    const outcome = resolveBet(b.market, b.selection, b.line == null ? null : Number(b.line), f)
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
    .from(bet).innerJoin(fixture, eq(bet.fixtureId, fixture.id))
    .where(and(eq(bet.status, 'open'), eq(fixture.status, 'final')))
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
