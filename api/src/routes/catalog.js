import { eq } from 'drizzle-orm'
import { catalogLeague } from '../db/schema.js'
import { requireAccount } from '../accounts/auth.js'
import { sportOf, seasonInWindow } from '../providers/registry.js'

const catalogQuery = {
  type: 'object', additionalProperties: false,
  properties: {
    sport: { type: 'string', minLength: 1, maxLength: 30 },
    q: { type: 'string', minLength: 2, maxLength: 80 },
  },
}

/** A season a user may actually provision: covered by standings AND inside our plan window. */
const provisionable = (row) => (row.seasons ?? [])
  .filter((s) => s.standings && seasonInWindow(row.provider, s.season))
  .sort((a, b) => (a.season < b.season ? 1 : -1))

export async function catalogRoutes(app) {
  app.get('/api/catalog', { preHandler: requireAccount(app), schema: { querystring: catalogQuery } }, async (req) => {
    const { sport, q } = req.query
    const rows = await app.db.select().from(catalogLeague).where(eq(catalogLeague.curated, true))
    const needle = q?.toLowerCase()
    return rows
      .map((r) => ({
        provider: r.provider, sport: sportOf(r.provider), leagueId: r.providerLeagueId,
        name: r.name, type: r.type, logo: r.logo, country: r.country, seasons: provisionable(r),
      }))
      .filter((r) => r.seasons.length)
      .filter((r) => !sport || r.sport === sport)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.country?.name ?? '').toLowerCase().includes(needle))
      .slice(0, 50)
  })
}
