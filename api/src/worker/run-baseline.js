import { asc } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { syncBaseline } from './baseline-sync.js'
import { competition } from '../db/schema.js'

const season = Number(process.env.WC_SEASON ?? 2026)
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
try {
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [defaultCompetition] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  const r = await syncBaseline(db, provider, { season, competitionId: defaultCompetition?.id })
  console.log(`baseline sync ok: ${r.fixtures} fixtures, ${r.standings} standings`)
} catch (e) {
  console.error('baseline sync FAILED (last-good data left intact):', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
