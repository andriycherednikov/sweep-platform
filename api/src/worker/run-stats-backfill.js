import { asc } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { resolveCrosswalk } from './crosswalk.js'
import { backfillFinalStatistics } from './live-poller.js'
import { competition } from '../db/schema.js'

// One-off: pull per-team statistics for the most recent final fixtures that don't have a
// snapshot yet (the live poller only covers the ~24h recovery window, so older completed
// games never get stats otherwise). Limit defaults to 5; override via argv or env.
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
const limit = Number(process.argv[2] || process.env.STATS_BACKFILL_LIMIT || 5)
try {
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [defaultCompetition] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  if (!defaultCompetition) { console.error('no competition found — run competition:add or db:seed first'); process.exit(1) }
  const crosswalk = await resolveCrosswalk(db, defaultCompetition.id)
  const { checked, updated } = await backfillFinalStatistics(db, provider, crosswalk, { limit })
  console.log(`stats backfill ok: checked ${checked} final fixture(s), stored stats for ${updated}`)
} catch (e) {
  console.error('stats backfill FAILED:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
