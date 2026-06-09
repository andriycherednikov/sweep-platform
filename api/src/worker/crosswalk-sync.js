import { eq } from 'drizzle-orm'
import { team, teamCrosswalk } from '../db/schema.js'
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'

const norm = (s) => (s ?? '').toLowerCase().trim()

/**
 * Match our teams to provider teams by exact name, then country.
 * @returns {{matched:{teamCode:string,providerTeamId:number}[], unmatchedProvider:any[], unmatchedOurs:any[]}}
 */
export function matchTeams(ourTeams, providerTeams) {
  const byName = new Map(providerTeams.map((p) => [norm(p.name), p]))
  const byCountry = new Map(providerTeams.map((p) => [norm(p.country), p]))
  const used = new Set()
  const matched = []
  const unmatchedOurs = []
  for (const t of ourTeams) {
    const hit = byName.get(norm(t.name)) ?? byCountry.get(norm(t.name))
    if (hit && !used.has(hit.providerTeamId)) {
      matched.push({ teamCode: t.code, providerTeamId: hit.providerTeamId })
      used.add(hit.providerTeamId)
    } else {
      unmatchedOurs.push(t)
    }
  }
  const unmatchedProvider = providerTeams.filter((p) => !used.has(p.providerTeamId))
  return { matched, unmatchedProvider, unmatchedOurs }
}

export async function syncCrosswalk(db, provider, { season }) {
  const [ourTeams, providerTeams] = await Promise.all([db.select().from(team), provider.fetchTeams(season)])
  const { matched, unmatchedProvider, unmatchedOurs } = matchTeams(ourTeams, providerTeams)
  for (const m of matched) {
    await db.update(teamCrosswalk).set({ providerTeamId: m.providerTeamId }).where(eq(teamCrosswalk.teamCode, m.teamCode))
  }
  return { matchedCount: matched.length, unmatchedOurs, unmatchedProvider }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const season = Number(process.env.WC_SEASON ?? 2026)
  const pool = createPool()
  const db = createDb(pool)
  const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
  const report = await syncCrosswalk(db, provider, { season })
  await pool.end()
  console.log(`crosswalk: matched ${report.matchedCount}/48`)
  if (report.unmatchedOurs.length) console.warn('UNMATCHED (ours, fill manually):', report.unmatchedOurs.map((t) => `${t.code}:${t.name}`).join(', '))
  if (report.unmatchedProvider.length) console.warn('UNMATCHED (provider):', report.unmatchedProvider.map((t) => `${t.providerTeamId}:${t.name}`).join(', '))
}
