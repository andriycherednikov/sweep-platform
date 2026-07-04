import { and, eq } from 'drizzle-orm'
import { competition, competitor, event, ranking } from '../db/schema.js'
import { flattenEvent } from '../db/event-shape.js'
import { fixtureResult } from '../wagering/settle.js'

/**
 * Recompute group standings from our OWN final results and upsert the ranking table.
 * Provider-free and instant: the moment a group fixture goes final, the table reflects it
 * (no 6-hourly wait, no extra API call). Only group-stage finals with both scores count;
 * knockout games never affect group tables. Ordering stays with the UI (pts → GD → GF),
 * and the periodic provider baseline still reconciles official tiebreakers.
 * @returns {Promise<number>} number of ranking rows written
 */
export async function recomputeStandings(db, competitionId) {
  const [comp] = await db.select({ sport: competition.sport }).from(competition).where(eq(competition.id, competitionId))
  if (comp?.sport !== 'football') return 0 // provider standings are authoritative for other sports

  const comps = await db.select({ code: competitor.code }).from(competitor)
    .where(eq(competitor.competitionId, competitionId))
  const finals = (await db.select().from(event)
    .where(and(eq(event.competitionId, competitionId), eq(event.status, 'final')))).map(flattenEvent)

  const agg = {}
  for (const t of comps) agg[t.code] = { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
  for (const f of finals) {
    if (f.stage !== 'group') continue
    if (f.score1 == null || f.score2 == null) continue
    const a = agg[f.t1Code], b = agg[f.t2Code]
    if (!a || !b) continue
    const res = fixtureResult(f)
    if (!res) continue
    a.played++; b.played++
    a.gf += f.score1; a.ga += f.score2
    b.gf += f.score2; b.ga += f.score1
    if (res === 'HOME') { a.win++; a.pts += 3; b.loss++ }
    else if (res === 'AWAY') { b.win++; b.pts += 3; a.loss++ }
    else { a.draw++; b.draw++; a.pts++; b.pts++ }
  }

  let written = 0
  for (const code of Object.keys(agg)) {
    const { pts, ...stats } = agg[code]
    const now = new Date()
    await db.insert(ranking).values({ competitionId, competitorCode: code, points: pts, stats, updatedAt: now })
      .onConflictDoUpdate({ target: [ranking.competitionId, ranking.competitorCode], set: { points: pts, stats, updatedAt: now } })
    written++
  }
  return written
}
