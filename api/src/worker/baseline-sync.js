import { notInArray, inArray, and, isNull, eq } from 'drizzle-orm'
import { event, ranking, ownership, syncLog, support, bet, coinLedger, parlay } from '../db/schema.js'
import { detailMerge } from '../db/event-shape.js'
import { resolveCrosswalk, assertResolved } from './crosswalk.js'
import { computeFlags } from './flags.js'
import { backfillFinalEvents } from './live-poller.js'
import { competitorCodeMap } from '../routes/competitors.js'

export async function refundPrunedParlays(db, keep, compEventIds) {
  // compEventIds scopes the prune to one competition's events; omitted only by the direct
  // unit test below, which exercises the refund logic globally on purpose.
  const cond = compEventIds ? and(notInArray(bet.fixtureId, keep), inArray(bet.fixtureId, compEventIds)) : notInArray(bet.fixtureId, keep)
  const legRows = await db.select({ parlayId: bet.parlayId }).from(bet).where(cond)
  const parlayIds = [...new Set(legRows.map((r) => r.parlayId).filter(Boolean))]
  if (!parlayIds.length) return
  const parls = await db.select().from(parlay).where(inArray(parlay.id, parlayIds))
  for (const pl of parls) {
    if (pl.status === 'open') {
      await db.insert(coinLedger)
        .values({ sweepId: pl.sweepId, personId: pl.personId, type: 'refund', amount: pl.stake, refId: pl.id })
        .onConflictDoNothing()
      await db.update(parlay).set({ status: 'refunded', settledAt: new Date() }).where(eq(parlay.id, pl.id))
    }
  }
  await db.delete(parlay).where(inArray(parlay.id, parlayIds)) // cascade-deletes the legs
}

/**
 * Fetch fixtures + standings + predictions, map provider ids via crosswalk (loud assert),
 * compute flags, upsert idempotently, prune fixtures no longer present, write a sync_log row.
 * On any failure: write an error sync_log row and rethrow — last-good data is untouched.
 */
export async function syncBaseline(db, provider, { season, competitionId }) {
  try {
    const [rawFixtures, standings, crosswalk, ownershipRows, codeById] = await Promise.all([
      provider.fetchFixtures(season),
      provider.fetchStandings(season),
      resolveCrosswalk(db, competitionId),
      db.select().from(ownership),
      competitorCodeMap(db, competitionId),
    ])
    // translate at the boundary (competitorId → code) so computeFlags stays pure/code-based;
    // rows for other competitions drop out (no code in this competition's map).
    const ownershipCodeRows = ownershipRows
      .map((o) => ({ personId: o.personId, teamCode: codeById.get(o.competitorId) }))
      .filter((o) => o.teamCode)

    // Group letters live on the standings rows ("Group A"); the third-placed ranking has none.
    const realStandings = standings.filter((s) => s.group)
    const groupByProvider = new Map(realStandings.map((s) => [s.providerTeamId, s.group]))

    const neededIds = rawFixtures.flatMap((f) => [f.homeProviderId, f.awayProviderId])
      .concat(realStandings.map((s) => s.providerTeamId))
    assertResolved(crosswalk, neededIds)

    // resolve provider ids → our codes; resolve the group from /standings, not the round string
    const fixtures = rawFixtures.map((f) => ({
      ...f,
      t1Code: crosswalk.get(f.homeProviderId),
      t2Code: crosswalk.get(f.awayProviderId),
      group: groupByProvider.get(f.homeProviderId) ?? groupByProvider.get(f.awayProviderId) ?? f.group ?? '',
    }))
    const flags = computeFlags(fixtures, ownershipCodeRows)

    // win probabilities: prefer bookmaker markets (prob from 1x2), fall back to /predictions.
    // best-effort per fixture (missing → leave prob null, never throw).
    const probById = new Map()
    const mById = new Map()
    for (const f of fixtures) {
      let m = null
      try { m = await provider.fetchOdds(f.id) } catch { /* best-effort */ }
      let prob = m?.prob ?? null
      if (!prob) { try { prob = await provider.fetchPredictions(f.id) } catch { /* best-effort */ } }
      if (m) mById.set(f.id, m)
      if (prob) probById.set(f.id, prob)
    }

    for (const f of fixtures) {
      const fl = flags.get(f.id)
      const prob = probById.get(f.id)
      const winnerCode = f.winnerSide === 'home' ? f.t1Code : f.winnerSide === 'away' ? f.t2Code : f.winnerSide === 'draw' ? 'DRAW' : null
      const m = mById.get(f.id)
      const detail = {
        group: f.group, matchday: f.matchday, venue: f.venue, city: f.city,
        minute: f.minute ?? null, phase: f.phase ?? null,
        ht: f.htScore1 == null ? null : [f.htScore1, f.htScore2],
        reg: f.regScore1 == null ? null : [f.regScore1, f.regScore2],
        pen: f.penScore1 == null ? null : [f.penScore1, f.penScore2],
        derby: fl.derby, doubleOwner: fl.doubleOwner,
        // predictions/markets are best-effort: omit when not freshly fetched so the jsonb
        // merge on update leaves the previously stored value untouched.
        ...(prob ? { prob } : {}), ...(m?.markets ? { markets: m.markets } : {}),
      }
      await db.insert(event).values({
        id: f.id, competitionId, c1Code: f.t1Code, c2Code: f.t2Code,
        startUtc: f.kickoffUtc, status: f.status, score1: f.score1, score2: f.score2,
        winnerCode, stage: f.stage || 'group', detail, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: event.id,
        set: {
          c1Code: f.t1Code, c2Code: f.t2Code, startUtc: f.kickoffUtc, status: f.status,
          score1: f.score1, score2: f.score2, winnerCode, stage: f.stage || 'group',
          detail: detailMerge(detail), // preserves stored lineups/events/statistics keys
          updatedAt: new Date(),
        },
      })
    }

    // prune fixtures not in the latest provider set. Clear dependent social rows first —
    // support FKs the event (photos already set-null on delete) — or the delete fails.
    // Guard the whole call: an empty fetch is suspicious — prune nothing rather than wipe the table.
    const keep = fixtures.map((f) => f.id)
    if (keep.length) {
      // this competition's event ids (kept + about-to-be-pruned) — re-evaluated at each use
      // below since we don't delete any events until after the dependent-row cleanup runs.
      // Without this, a notInArray(x.fixtureId, keep) alone is global and would also wipe
      // every OTHER competition's support/bet/parlay rows (their fixtureIds are never in `keep`).
      const compEventIds = db.select({ id: event.id }).from(event).where(eq(event.competitionId, competitionId))
      await db.delete(support).where(and(notInArray(support.fixtureId, keep), inArray(support.fixtureId, compEventIds)))
      // a parlay with a leg on a dropped fixture can never complete → refund + delete it
      // (ON DELETE CASCADE drops its legs) before we touch single bets below.
      await refundPrunedParlays(db, keep, compEventIds)
      // a single bet's stake/payout ledger rows use refId = bet.id; drop them with the bet so a
      // pruned fixture doesn't leave the person's balance debited for a bet that's gone.
      // Only single bets here (parlayId NULL) — parlay legs were removed via refundPrunedParlays.
      const prunedBets = await db.select({ id: bet.id }).from(bet).where(and(notInArray(bet.fixtureId, keep), isNull(bet.parlayId), inArray(bet.fixtureId, compEventIds)))
      if (prunedBets.length) await db.delete(coinLedger).where(inArray(coinLedger.refId, prunedBets.map((b) => b.id)))
      await db.delete(bet).where(and(notInArray(bet.fixtureId, keep), isNull(bet.parlayId), inArray(bet.fixtureId, compEventIds)))
      // scoped by competitionId: another competition's events are never in `keep`, so an
      // unscoped notInArray would wipe them too.
      await db.delete(event).where(and(eq(event.competitionId, competitionId), notInArray(event.id, keep)))
    }

    for (const s of realStandings) {
      const teamCode = crosswalk.get(s.providerTeamId)
      const stats = { played: s.played, win: s.win, draw: s.draw, loss: s.loss, gf: s.gf, ga: s.ga }
      await db.insert(ranking).values({
        competitionId, competitorCode: teamCode, points: s.pts, stats, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [ranking.competitionId, ranking.competitorCode],
        set: { points: s.pts, stats, updatedAt: new Date() },
      })
    }

    // backfill events for finished matches that were never event-polled (e.g. games that
    // ended before this shipped, or during worker downtime). Best-effort: a failure here
    // must never fail the baseline. Idempotent — converges to a no-op once all are stored.
    let eventsBackfilled = 0
    try { eventsBackfilled = await backfillFinalEvents(db, provider, crosswalk) } catch { /* best-effort */ }

    await db.insert(syncLog).values({
      source: 'api-football', kind: 'baseline', status: 'ok',
      counts: { fixtures: fixtures.length, standings: realStandings.length, probs: probById.size, eventsBackfilled },
    })
    return { fixtures: fixtures.length, standings: realStandings.length, eventsBackfilled }
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
