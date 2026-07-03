import { and, eq } from 'drizzle-orm'
import { competitor } from '../db/schema.js'

/** Wire→DB: resolve a competitor's wire-level code to its id, scoped to one competition. Null if unknown. */
export async function codeToCompetitorId(db, competitionId, code) {
  const [row] = await db.select({ id: competitor.id }).from(competitor)
    .where(and(eq(competitor.competitionId, competitionId), eq(competitor.code, code)))
  return row?.id ?? null
}

/** DB→wire: every competitor in a competition, id → code. */
export async function competitorCodeMap(db, competitionId) {
  const rows = await db.select({ id: competitor.id, code: competitor.code }).from(competitor)
    .where(eq(competitor.competitionId, competitionId))
  return new Map(rows.map((r) => [r.id, r.code]))
}
