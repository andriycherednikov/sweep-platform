import { and, eq, isNotNull } from 'drizzle-orm'
import { competitor } from '../db/schema.js'

/** @returns {Promise<Map<number,string>>} providerId → competitor.code for one competition. */
export async function resolveCrosswalk(db, competitionId) {
  const rows = await db.select({ code: competitor.code, providerId: competitor.providerId })
    .from(competitor)
    .where(and(eq(competitor.competitionId, competitionId), isNotNull(competitor.providerId)))
  return new Map(rows.map((r) => [r.providerId, r.code]))
}

export function assertResolved(map, providerIds) {
  const missing = [...new Set(providerIds)].filter((id) => !map.has(id))
  if (missing.length) {
    throw new Error(`competitor.provider_id missing for provider team ids: ${missing.join(', ')}. Run \`npm run crosswalk:sync -w api\` and fill any unmatched.`)
  }
}
