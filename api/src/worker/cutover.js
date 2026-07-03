// One-shot: cut the database over from the demo seed to the REAL API-Football WC field.
//   1. clear placeholder fixtures + standings (they reference demo team codes)
//   2. reconcile the team table to the real 48 (syncTeams) — drops absent teams + their
//      ownership, keeps matched codes, inserts new real teams, fills the crosswalk
//   3. baseline-sync real fixtures + standings + predictions
// Idempotent: safe to re-run. Requires API_FOOTBALL_KEY in .env.
import { asc } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { syncTeams } from './sync-teams.js'
import { syncBaseline } from './baseline-sync.js'
import { fixture, standing, competition } from '../db/schema.js'

const season = Number(process.env.WC_SEASON ?? 2026)
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })

try {
  await db.delete(fixture)
  await db.delete(standing)
  const t = await syncTeams(db, provider, { season })
  console.log(`teams: matched ${t.matched}, inserted ${t.inserted}, deleted ${t.deleted}`)
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [defaultCompetition] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  const b = await syncBaseline(db, provider, { season, competitionId: defaultCompetition?.id })
  console.log(`baseline: ${b.fixtures} fixtures, ${b.standings} standings`)
  console.log('cutover complete')
} catch (e) {
  console.error('cutover FAILED:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
