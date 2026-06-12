import { notInArray } from 'drizzle-orm'
import { fixture, standing, ownership, syncLog, watch, support } from '../db/schema.js'
import { resolveCrosswalk, assertResolved } from './crosswalk.js'
import { computeFlags } from './flags.js'

/**
 * Fetch fixtures + standings + predictions, map provider ids via crosswalk (loud assert),
 * compute flags, upsert idempotently, prune fixtures no longer present, write a sync_log row.
 * On any failure: write an error sync_log row and rethrow — last-good data is untouched.
 */
export async function syncBaseline(db, provider, { season }) {
  try {
    const [rawFixtures, standings, crosswalk, ownershipRows] = await Promise.all([
      provider.fetchFixtures(season),
      provider.fetchStandings(season),
      resolveCrosswalk(db),
      db.select().from(ownership),
    ])

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
    const flags = computeFlags(fixtures, ownershipRows)

    // win probabilities: prefer bookmaker odds, fall back to /predictions.
    // best-effort per fixture (missing → leave prob null, never throw).
    const probById = new Map()
    for (const f of fixtures) {
      let p = null
      try { p = await provider.fetchOdds(f.id) } catch { /* best-effort */ }
      if (!p) { try { p = await provider.fetchPredictions(f.id) } catch { /* best-effort */ } }
      if (p) probById.set(f.id, p)
    }

    for (const f of fixtures) {
      const fl = flags.get(f.id)
      const prob = probById.get(f.id)
      await db.insert(fixture).values({
        id: f.id, group: f.group, matchday: f.matchday, t1Code: f.t1Code, t2Code: f.t2Code,
        kickoffUtc: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
        score1: f.score1, score2: f.score2, minute: f.minute,
        probA: prob?.a ?? null, probD: prob?.d ?? null, probB: prob?.b ?? null,
        stage: f.stage || 'group', derby: fl.derby, doubleOwner: fl.doubleOwner, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: fixture.id,
        set: {
          group: f.group, matchday: f.matchday, t1Code: f.t1Code, t2Code: f.t2Code,
          kickoffUtc: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
          score1: f.score1, score2: f.score2, minute: f.minute,
          // predictions are best-effort: only overwrite when we got fresh numbers
          ...(prob ? { probA: prob.a, probD: prob.d, probB: prob.b } : {}),
          stage: f.stage || 'group', derby: fl.derby, doubleOwner: fl.doubleOwner, updatedAt: new Date(),
        },
      })
    }

    // prune fixtures not in the latest provider set. Clear dependent social rows first —
    // watch/support FK the fixture (photos already set-null on delete) — or the delete fails.
    // Guard the whole call: an empty fetch is suspicious — prune nothing rather than wipe the table.
    const keep = fixtures.map((f) => f.id)
    if (keep.length) {
      await db.delete(watch).where(notInArray(watch.fixtureId, keep))
      await db.delete(support).where(notInArray(support.fixtureId, keep))
      await db.delete(fixture).where(notInArray(fixture.id, keep))
    }

    for (const s of realStandings) {
      const teamCode = crosswalk.get(s.providerTeamId)
      await db.insert(standing).values({
        teamCode, played: s.played, win: s.win, draw: s.draw, loss: s.loss, gf: s.gf, ga: s.ga, pts: s.pts, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: standing.teamCode,
        set: { played: s.played, win: s.win, draw: s.draw, loss: s.loss, gf: s.gf, ga: s.ga, pts: s.pts, updatedAt: new Date() },
      })
    }

    await db.insert(syncLog).values({
      source: 'api-football', kind: 'baseline', status: 'ok',
      counts: { fixtures: fixtures.length, standings: realStandings.length, probs: probById.size },
    })
    return { fixtures: fixtures.length, standings: realStandings.length }
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
