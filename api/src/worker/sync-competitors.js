import { and, eq, sql } from 'drizzle-orm'
import { competitor, ownership, ranking } from '../db/schema.js'

/** Lowercase, strip accents, collapse non-alphanumerics to single hyphens. */
export function slugName(name) {
  return (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
}

/** Deterministic team tint — the web colors by competitor.color (NOT NULL). */
export function colorFor(code) {
  let h = 0
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 65% 45%)`
}

/**
 * Reconcile a FEED-BORN competition's competitor rows straight from the provider
 * (football's curated seed + reconcile-teams path is separate by design).
 * Match by providerId; insert new with slug codes; delete leavers + their ownership/ranking.
 */
export async function syncCompetitors(db, provider, comp) {
  const [teams, standings, ours] = await Promise.all([
    provider.fetchCompetitors(comp),
    provider.fetchStandings(comp),
    db.select().from(competitor).where(eq(competitor.competitionId, comp.id)),
  ])
  const conferenceByProvider = new Map(standings.map((s) => [s.providerTeamId, s.group]))
  const oursByProviderId = new Map(ours.filter((c) => c.providerId != null).map((c) => [c.providerId, c]))
  const usedCodes = new Set(ours.map((c) => c.code))
  let inserted = 0, updated = 0, deleted = 0

  const seen = new Set()
  for (const t of teams) {
    seen.add(t.providerTeamId)
    const conference = conferenceByProvider.get(t.providerTeamId) ?? null
    const mine = oursByProviderId.get(t.providerTeamId)
    if (mine) {
      await db.update(competitor)
        .set({ name: t.name, logo: t.logo, meta: sql`coalesce(${competitor.meta}, '{}'::jsonb) || ${JSON.stringify({ conference })}::jsonb` })
        .where(eq(competitor.id, mine.id))
      updated++
    } else {
      let code = slugName(t.name) || `t${t.providerTeamId}`
      let i = 2
      while (usedCodes.has(code)) code = `${slugName(t.name)}-${i++}`
      usedCodes.add(code)
      await db.insert(competitor).values({
        id: `cp_${comp.id}_${code}`, competitionId: comp.id, code, name: t.name,
        color: colorFor(code), logo: t.logo, providerId: t.providerTeamId, meta: { conference },
      })
      inserted++
    }
  }

  for (const c of ours) {
    if (c.providerId != null && !seen.has(c.providerId)) {
      await db.delete(ownership).where(eq(ownership.competitorId, c.id))
      await db.delete(ranking).where(and(eq(ranking.competitionId, comp.id), eq(ranking.competitorCode, c.code)))
      await db.delete(competitor).where(eq(competitor.id, c.id))
      deleted++
    }
  }
  return { inserted, updated, deleted }
}
