import { sql } from 'drizzle-orm'
import { event } from './schema.js'

const pair = (a) => (Array.isArray(a) ? [a[0] ?? null, a[1] ?? null] : [null, null])

/** Flatten an `event` row (+ its detail jsonb) into the legacy fixture field names,
 *  so settlement/serialization logic ports without rewriting its reads. */
export function flattenEvent(row) {
  const d = row.detail ?? {}
  const [htScore1, htScore2] = pair(d.ht)
  const [regScore1, regScore2] = pair(d.reg)
  const [penScore1, penScore2] = pair(d.pen)
  return {
    id: row.id, competitionId: row.competitionId,
    t1Code: row.c1Code, t2Code: row.c2Code,
    kickoffUtc: row.startUtc, status: row.status,
    score1: row.score1, score2: row.score2, winnerCode: row.winnerCode,
    stage: row.stage, round: row.round,
    group: d.group ?? null, matchday: d.matchday ?? null,
    venue: d.venue ?? null, city: d.city ?? null,
    minute: d.minute ?? null, phase: d.phase ?? null,
    htScore1, htScore2, regScore1, regScore2, penScore1, penScore2,
    probA: d.prob?.a ?? null, probD: d.prob?.d ?? null, probB: d.prob?.b ?? null,
    markets: d.markets ?? null, lineups: d.lineups ?? null,
    events: d.events ?? null, statistics: d.statistics ?? null,
    derby: d.derby ?? false, doubleOwner: d.doubleOwner ?? false,
    updatedAt: row.updatedAt,
  }
}

/** jsonb merge fragment: stored detail wins nothing, patch keys overwrite, other keys survive. */
export function detailMerge(patch) {
  return sql`${event.detail} || ${JSON.stringify(patch)}::jsonb`
}
