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

/** A season a user may actually provision: covered by standings, inside our plan
 *  window, and not already over — a sweep on a finished season has nothing to
 *  play for, so the catalog never offers one. */
const provisionable = (row, now) => (row.seasons ?? [])
  .filter((s) => s.standings && seasonInWindow(row.provider, s.season))
  .filter((s) => !s.end || Date.parse(s.end) >= now)
  .sort((a, b) => (a.season < b.season ? 1 : -1))

export async function catalogRoutes(app) {
  app.get('/api/catalog', { preHandler: requireAccount(app), schema: { querystring: catalogQuery } }, async (req) => {
    const { sport, q } = req.query
    const now = Date.now()
    const rows = await app.db.select().from(catalogLeague).where(eq(catalogLeague.curated, true))
    const needle = q?.toLowerCase()
    return rows
      .map((r) => ({
        provider: r.provider, sport: sportOf(r.provider), leagueId: r.providerLeagueId,
        name: r.name, type: r.type, logo: r.logo, country: r.country, seasons: provisionable(r, now),
      }))
      .filter((r) => r.seasons.length)
      .filter((r) => !sport || r.sport === sport)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.country?.name ?? '').toLowerCase().includes(needle))
      .slice(0, 50)
  })
}
