import { eq } from 'drizzle-orm'
import { team, teamCrosswalk, ownership, standing, photo } from '../db/schema.js'
import { reconcileTeams } from './reconcile-teams.js'

/**
 * Reconcile the `team` table to the real API-Football WC field:
 *  - matched teams keep their code (ownership/photos survive), re-pinned to real group + provider id
 *  - real teams we lack are inserted with a derived code
 *  - teams absent from the real field are removed, along with their ownership/standing/crosswalk
 *    rows (photos tagged to them are untagged, not deleted)
 *
 * Precondition: any `fixture` rows referencing soon-to-be-deleted teams must already be cleared
 * (the cutover clears fixtures+standings first). Returns {matched, inserted, deleted}.
 */
export async function syncTeams(db, provider, { season }) {
  const [realTeams, standings, ourTeams] = await Promise.all([
    provider.fetchTeams(season),
    provider.fetchStandings(season),
    db.select().from(team),
  ])
  const groupByProvider = new Map(standings.filter((s) => s.group).map((s) => [s.providerTeamId, s.group]))
  const plan = reconcileTeams(ourTeams, realTeams, groupByProvider)

  for (const code of plan.deletes) {
    await db.delete(ownership).where(eq(ownership.teamCode, code))
    await db.update(photo).set({ teamCode: null }).where(eq(photo.teamCode, code))
    await db.delete(standing).where(eq(standing.teamCode, code))
    await db.delete(teamCrosswalk).where(eq(teamCrosswalk.teamCode, code))
    await db.delete(team).where(eq(team.code, code))
  }

  for (const u of plan.updates) {
    await db.update(team).set({ name: u.name, group: u.group }).where(eq(team.code, u.code))
    await db.insert(teamCrosswalk).values({ teamCode: u.code, providerTeamId: u.providerTeamId })
      .onConflictDoUpdate({ target: teamCrosswalk.teamCode, set: { providerTeamId: u.providerTeamId } })
  }

  for (const i of plan.inserts) {
    await db.insert(team).values({
      code: i.code, name: i.name, group: i.group, pool: i.pool,
      color: i.color, strength: i.strength, flagCode: i.flagCode,
    }).onConflictDoNothing()
    await db.insert(teamCrosswalk).values({ teamCode: i.code, providerTeamId: i.providerTeamId })
      .onConflictDoUpdate({ target: teamCrosswalk.teamCode, set: { providerTeamId: i.providerTeamId } })
  }

  return plan.stats
}
