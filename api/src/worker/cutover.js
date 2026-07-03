// One-shot: cut the database over from the demo seed to the REAL API-Football WC field.
//   1. clear placeholder events + rankings (they reference demo competitor codes)
//   2. reconcile the competitor table to the real 48 (syncTeams) — drops absent teams + their
//      ownership, keeps matched codes, inserts new real teams, sets provider ids directly
//   3. baseline-sync real fixtures + standings + predictions
// Idempotent: safe to re-run. Requires API_FOOTBALL_KEY in .env.
import { asc, eq } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { syncTeams } from './sync-teams.js'
import { syncBaseline } from './baseline-sync.js'
import { event, ranking, competition } from '../db/schema.js'

const season = Number(process.env.WC_SEASON ?? 2026)
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })

try {
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [defaultCompetition] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  const competitionId = defaultCompetition?.id
  await db.delete(event).where(eq(event.competitionId, competitionId))
  await db.delete(ranking).where(eq(ranking.competitionId, competitionId))
  const t = await syncTeams(db, provider, { season, competitionId })
  console.log(`teams: matched ${t.matched}, inserted ${t.inserted}, deleted ${t.deleted}`)
  const b = await syncBaseline(db, provider, { season, competitionId })
  console.log(`baseline: ${b.fixtures} fixtures, ${b.standings} standings`)
  console.log('cutover complete')
} catch (e) {
  console.error('cutover FAILED:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
