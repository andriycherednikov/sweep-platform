import { and, asc, eq, sql } from 'drizzle-orm'
import { competitor, syncLog, competition } from '../db/schema.js'
import { resolveCrosswalk } from './crosswalk.js'

/**
 * Fetch each crosswalked team's squad (players/squads) and store it on `competitor.meta.squad`.
 * Squads are stable, so this is a one-shot/occasional sync (not the windowed worker).
 * Best-effort per team: a failed or empty fetch leaves the prior squad untouched.
 * @returns {Promise<number>} count of teams whose squad was stored
 */
export async function syncSquads(db, provider) {
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [defaultCompetition] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  const crosswalk = await resolveCrosswalk(db, defaultCompetition?.id) // Map<providerTeamId, code>
  let updated = 0
  for (const [providerTeamId, code] of crosswalk) {
    try {
      const squad = await provider.fetchSquad(providerTeamId)
      if (!squad) continue
      await db.update(competitor)
        .set({ meta: sql`${competitor.meta} || ${JSON.stringify({ squad })}::jsonb` })
        .where(and(eq(competitor.competitionId, defaultCompetition.id), eq(competitor.code, code)))
      updated++
    } catch { /* best-effort per team */ }
  }
  await db.insert(syncLog).values({ source: 'api-football', kind: 'squads', status: 'ok', counts: { teams: crosswalk.size, updated } })
  return updated
}
