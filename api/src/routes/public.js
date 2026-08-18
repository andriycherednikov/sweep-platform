import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { competition, competitor, event } from '../db/schema.js'

const LIMIT = 20

/** Unauthenticated feed for the marketing page: the most recent finished games.
 *  Sports facts only — no sweep, person or account data is reachable from here. */
export async function publicRoutes(app) {
  app.get('/api/public/results', async () => {
    const rows = await app.db.select({
      id: event.id, competitionId: event.competitionId, c1Code: event.c1Code, c2Code: event.c2Code,
      score1: event.score1, score2: event.score2, winnerCode: event.winnerCode, startUtc: event.startUtc,
      competitionName: competition.name, sport: competition.sport,
    })
      .from(event)
      .innerJoin(competition, eq(competition.id, event.competitionId))
      .where(and(eq(event.status, 'final'), isNotNull(event.score1), isNotNull(event.score2)))
      .orderBy(desc(event.startUtc))
      .limit(LIMIT)
    if (!rows.length) return []

    // one lookup for every competitor mentioned, rather than a query per row
    const comps = await app.db.select({ competitionId: competitor.competitionId, code: competitor.code, name: competitor.name, logo: competitor.logo })
      .from(competitor)
      .where(inArray(competitor.competitionId, [...new Set(rows.map((r) => r.competitionId))]))
    const byKey = new Map(comps.map((c) => [`${c.competitionId}|${c.code}`, c]))
    const side = (r, code, score) => {
      const c = byKey.get(`${r.competitionId}|${code}`)
      return { name: c?.name ?? code, logo: c?.logo ?? null, score, won: r.winnerCode === code }
    }

    return rows.map((r) => ({
      id: r.id, competition: r.competitionName, sport: r.sport, playedAt: r.startUtc,
      home: side(r, r.c1Code, r.score1), away: side(r, r.c2Code, r.score2),
    }))
  })
}
