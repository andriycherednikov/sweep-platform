import { eq } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { providerFor, sportOf } from '../providers/registry.js'
import { syncCompetitors } from './sync-competitors.js'
import { syncBaseline } from './baseline-sync.js'
import { competition } from '../db/schema.js'

/** Provision a competition from the provider catalog: row + competitors + first baseline. */
export async function addCompetition(db, provider, { provider: providerKey, leagueId, season }) {
  const leagues = await provider.fetchCompetitions()
  const league = leagues.find((l) => String(l.providerLeagueId) === String(leagueId))
  if (!league) throw new Error(`league ${leagueId} not found in ${providerKey} catalog`)
  const id = `${providerKey}:${leagueId}:${season}`
  const [existing] = await db.select().from(competition).where(eq(competition.id, id))
  if (existing) throw new Error(`competition already exists: ${id}`)
  const comp = {
    id, provider: providerKey, sport: sportOf(providerKey), leagueId: String(leagueId), season: String(season),
    format: league.type === 'League' ? 'league' : 'groups_then_ko', name: league.name, logo: league.logo,
  }
  await db.insert(competition).values(comp)
  const c = await syncCompetitors(db, provider, comp)
  const b = await syncBaseline(db, provider, comp)
  return { competitionId: id, competitors: c.inserted + c.updated, fixtures: b.fixtures }
}

// CLI: npm run competition:add -w api -- <provider> <leagueId> <season>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [providerKey, leagueId, season] = process.argv.slice(2)
  if (!providerKey || !leagueId || !season) {
    console.error('usage: npm run competition:add -w api -- <apifootball|apibasketball> <leagueId> <season>')
    process.exit(1)
  }
  const pool = createPool()
  const db = createDb(pool)
  try {
    const r = await addCompetition(db, providerFor({ provider: providerKey }), { provider: providerKey, leagueId, season })
    console.log(`added ${r.competitionId}: ${r.competitors} competitors, ${r.fixtures} fixtures`)
  } catch (e) {
    console.error('competition:add FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
