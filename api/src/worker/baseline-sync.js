import { notInArray } from 'drizzle-orm'
import { fixture, standing, ownership, syncLog } from '../db/schema.js'
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

    const neededIds = rawFixtures.flatMap((f) => [f.homeProviderId, f.awayProviderId])
      .concat(standings.map((s) => s.providerTeamId))
    assertResolved(crosswalk, neededIds)

    // resolve provider ids → our codes
    const fixtures = rawFixtures.map((f) => ({
      ...f, t1Code: crosswalk.get(f.homeProviderId), t2Code: crosswalk.get(f.awayProviderId),
    }))
    const flags = computeFlags(fixtures, ownershipRows)

    // predictions: best-effort per fixture (missing → leave prob null, never throw)
    const probById = new Map()
    for (const f of fixtures) {
      try { const p = await provider.fetchPredictions(f.id); if (p) probById.set(f.id, p) } catch { /* best-effort */ }
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

    // prune fixtures not in the latest provider set (safe pre-Phase-4; no watch/support rows yet).
    // Guard the whole call: an empty fetch is suspicious — prune nothing rather than wipe the table.
    const keep = fixtures.map((f) => f.id)
    if (keep.length) await db.delete(fixture).where(notInArray(fixture.id, keep))

    for (const s of standings) {
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
      counts: { fixtures: fixtures.length, standings: standings.length, predictions: probById.size },
    })
    return { fixtures: fixtures.length, standings: standings.length }
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
