import { eq } from 'drizzle-orm'
import { team, fixture, standing } from '../db/schema.js'
import { fixtureResult } from '../coins/settle.js'

/**
 * Recompute group standings from our OWN final results and upsert the standing table.
 * Provider-free and instant: the moment a group fixture goes final, the table reflects it
 * (no 6-hourly wait, no extra API call). Only group-stage finals with both scores count;
 * knockout games never affect group tables. Ordering stays with the UI (pts → GD → GF),
 * and the periodic provider baseline still reconciles official tiebreakers.
 * @returns {Promise<number>} number of standing rows written
 */
export async function recomputeStandings(db) {
  const teams = await db.select({ code: team.code }).from(team)
  const finals = await db.select().from(fixture).where(eq(fixture.status, 'final'))

  const agg = {}
  for (const t of teams) agg[t.code] = { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }

  for (const f of finals) {
    if (f.stage !== 'group') continue
    if (f.score1 == null || f.score2 == null) continue
    const a = agg[f.t1Code], b = agg[f.t2Code]
    if (!a || !b) continue
    a.played++; b.played++
    a.gf += f.score1; a.ga += f.score2
    b.gf += f.score2; b.ga += f.score1
    const res = fixtureResult(f)
    if (res === 'HOME') { a.win++; a.pts += 3; b.loss++ }
    else if (res === 'AWAY') { b.win++; b.pts += 3; a.loss++ }
    else { a.draw++; b.draw++; a.pts++; b.pts++ }
  }

  let written = 0
  for (const code of Object.keys(agg)) {
    const s = agg[code]
    const now = new Date()
    await db.insert(standing).values({ teamCode: code, ...s, updatedAt: now })
      .onConflictDoUpdate({ target: standing.teamCode, set: { ...s, updatedAt: now } })
    written++
  }
  return written
}
