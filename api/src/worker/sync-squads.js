import { eq } from 'drizzle-orm'
import { team, syncLog } from '../db/schema.js'
import { resolveCrosswalk } from './crosswalk.js'

/**
 * Fetch each crosswalked team's squad (players/squads) and store it on `team.squad`.
 * Squads are stable, so this is a one-shot/occasional sync (not the windowed worker).
 * Best-effort per team: a failed or empty fetch leaves the prior squad untouched.
 * @returns {Promise<number>} count of teams whose squad was stored
 */
export async function syncSquads(db, provider) {
  const crosswalk = await resolveCrosswalk(db) // Map<providerTeamId, teamCode>
  let updated = 0
  for (const [providerTeamId, code] of crosswalk) {
    try {
      const squad = await provider.fetchSquad(providerTeamId)
      if (!squad) continue
      await db.update(team).set({ squad }).where(eq(team.code, code))
      updated++
    } catch { /* best-effort per team */ }
  }
  await db.insert(syncLog).values({ source: 'api-football', kind: 'squads', status: 'ok', counts: { teams: crosswalk.size, updated } })
  return updated
}
