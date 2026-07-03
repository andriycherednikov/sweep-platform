import { and, eq, sql } from 'drizzle-orm'
import { competitor, ownership, ranking } from '../db/schema.js'
import { reconcileTeams } from './reconcile-teams.js'

/**
 * Reconcile the `competitor` table (one competition) to the real API-Football WC field:
 *  - matched teams keep their code (ownership survives), re-pinned to real group + provider id
 *  - real teams we lack are inserted with a derived code
 *  - teams absent from the real field are removed, along with their ownership/ranking rows
 *
 * Precondition: any `event` rows referencing soon-to-be-deleted competitors must already be
 * cleared (the cutover clears events+rankings first). Returns {matched, inserted, deleted}.
 */
export async function syncTeams(db, provider, { season, competitionId }) {
  const [realTeams, standings, ourCompetitors] = await Promise.all([
    provider.fetchCompetitors({ season, leagueId: '1' }),
    provider.fetchStandings({ season, leagueId: '1' }),
    db.select().from(competitor).where(eq(competitor.competitionId, competitionId)),
  ])
  const ourTeams = ourCompetitors.map((c) => ({ code: c.code, name: c.name, group: c.meta?.group ?? '' }))
  const idByCode = new Map(ourCompetitors.map((c) => [c.code, c.id]))
  const groupByProvider = new Map(standings.filter((s) => s.group).map((s) => [s.providerTeamId, s.group]))
  const plan = reconcileTeams(ourTeams, realTeams, groupByProvider)

  for (const code of plan.deletes) {
    await db.delete(ownership).where(eq(ownership.competitorId, idByCode.get(code)))
    await db.delete(ranking).where(and(eq(ranking.competitionId, competitionId), eq(ranking.competitorCode, code)))
    await db.delete(competitor).where(and(eq(competitor.competitionId, competitionId), eq(competitor.code, code)))
  }

  for (const u of plan.updates) {
    await db.update(competitor)
      .set({ name: u.name, providerId: u.providerTeamId, meta: sql`${competitor.meta} || ${JSON.stringify({ group: u.group })}::jsonb` })
      .where(and(eq(competitor.competitionId, competitionId), eq(competitor.code, u.code)))
  }

  for (const i of plan.inserts) {
    await db.insert(competitor).values({
      id: `cp_${competitionId}_${i.code}`, competitionId, code: i.code, name: i.name, color: i.color, providerId: i.providerTeamId,
      meta: { group: i.group, pool: i.pool, strength: i.strength },
    }).onConflictDoNothing()
  }

  return plan.stats
}
