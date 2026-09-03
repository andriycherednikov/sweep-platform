import { and, eq, inArray, ne } from 'drizzle-orm'
import { event, bet, parlay, coinLedger, competition, syncLog } from './db/schema.js'
import { detailMerge } from './db/event-shape.js'
import { settleBets } from './wagering/settle.js'
import { grantMatchRewards } from './wagering/rewards.js'
import { recomputeStandings } from './worker/recompute-standings.js'

/**
 * Correct a wrong result by hand, and unwind everything the wrong one caused.
 *
 * No sports-data vendor ships corrections, and API-Sports' terms say bad data "does not
 * constitute a valid reason for a refund" — so when the feed gets a score wrong, the
 * operator is the only remedy. Overwriting the score alone is not that remedy: the wrong
 * score has already paid out bets, granted prediction rewards and moved the table.
 *
 * So: reverse, then re-run the same settlement path the worker uses, rather than trying
 * to compute the difference. Reversal deletes only what settlement created — payouts and
 * rewards — and never touches a stake, which was taken when the bet was placed and is
 * not settlement's to give back.
 *
 * A correction is competition-level: every sweep following that competition sees it.
 * That is why this is an operator action and not a group admin's.
 */
export async function correctFixture(db, fixtureId, { score1, score2, status, reg, pen, reason }, publish = () => {}) {
  const [row] = await db.select().from(event).where(eq(event.id, fixtureId))
  if (!row) return null

  const from = [row.score1, row.score2]
  const winnerCode = score1 > score2 ? row.c1Code : score1 < score2 ? row.c2Code : 'DRAW'

  // Football and anything else that grades on regulation reads detail.reg, not score1/2.
  // Leaving it stale would re-settle every ml bet on the score we just corrected away
  // from. Default it to the corrected pair; an operator fixing a match decided in extra
  // time or on penalties passes reg/pen explicitly.
  const detail = { reg: reg ?? [score1, score2], correction: { from, to: [score1, score2], reason, at: new Date().toISOString() } }
  if (pen) detail.pen = pen

  await db.update(event)
    .set({ score1, score2, winnerCode, status: status ?? row.status, detail: detailMerge(detail), updatedAt: new Date() })
    .where(eq(event.id, fixtureId))

  const { reopenedBets, reopenedParlays } = await reverseSettlement(db, fixtureId)

  // Re-run the vetted, idempotent path — the same one the worker runs when a fixture
  // goes final — so a correction and a normal settle can never disagree.
  await settleBets(db, fixtureId, publish)
  await grantMatchRewards(db, fixtureId, publish)
  await recomputeStandings(db, row.competitionId)
  await publish({ type: 'sync' })

  await db.insert(syncLog).values({
    source: 'operator', competitionId: row.competitionId, kind: 'correction', status: 'ok',
    counts: { fixtureId, from, to: [score1, score2], reopenedBets, reopenedParlays, reason },
  })

  return { fixtureId, from, to: [score1, score2], reopenedBets, reopenedParlays }
}

/**
 * Put every bet on this fixture back to 'open' and delete what settlement paid for it,
 * so the re-run starts from a clean slate. Stakes and week grants are left alone.
 */
async function reverseSettlement(db, fixtureId) {
  const settled = await db.select().from(bet)
    .where(and(eq(bet.fixtureId, fixtureId), ne(bet.status, 'open')))
  const betIds = settled.map((b) => b.id)
  const parlayIds = [...new Set(settled.map((b) => b.parlayId).filter(Boolean))]

  if (betIds.length) {
    await db.delete(coinLedger).where(and(eq(coinLedger.type, 'payout'), inArray(coinLedger.refId, betIds)))
    await db.update(bet).set({ status: 'open', settledAt: null }).where(inArray(bet.id, betIds))
  }
  if (parlayIds.length) {
    // A parlay's payout is the parent's, keyed by parlay id — reopening the leg is not
    // enough, the accumulator has to give its winnings back and be rolled up again.
    await db.delete(coinLedger).where(and(eq(coinLedger.type, 'payout'), inArray(coinLedger.refId, parlayIds)))
    await db.update(parlay).set({ status: 'open', settledAt: null }).where(inArray(parlay.id, parlayIds))
  }
  // Match rewards are keyed by the fixture itself, and grantMatchRewards is
  // insert-if-absent — so they must go before it runs, or a reward earned on the wrong
  // score would survive the correction.
  await db.delete(coinLedger).where(and(inArray(coinLedger.type, ['predict', 'teamwin']), eq(coinLedger.refId, fixtureId)))

  return { reopenedBets: betIds.length, reopenedParlays: parlayIds.length }
}

/** The competition a fixture belongs to — the operator route needs it for the audit row. */
export async function competitionOf(db, fixtureId) {
  const [row] = await db.select({ competitionId: event.competitionId }).from(event).where(eq(event.id, fixtureId))
  if (!row) return null
  const [comp] = await db.select().from(competition).where(eq(competition.id, row.competitionId))
  return comp ?? null
}
