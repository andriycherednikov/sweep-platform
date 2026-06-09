import { teamCrosswalk } from '../db/schema.js'

/** @returns {Promise<Map<number,string>>} providerTeamId → team.code, only for filled rows. */
export async function resolveCrosswalk(db) {
  const rows = await db.select().from(teamCrosswalk)
  const map = new Map()
  for (const r of rows) if (r.providerTeamId != null) map.set(r.providerTeamId, r.teamCode)
  return map
}

/** Throw if any provider id we need isn't in the crosswalk — fail loudly, never silently drop a match. */
export function assertResolved(map, providerIds) {
  const missing = [...new Set(providerIds)].filter((id) => !map.has(id))
  if (missing.length) {
    throw new Error(`team_crosswalk missing provider team ids: ${missing.join(', ')}. Run \`npm run crosswalk:sync -w api\` and fill any unmatched.`)
  }
}
