import { expect, test, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competitor, event, ranking } from '../src/db/schema.js'
import { seed } from '../src/seed/seed.js'
import { recomputeStandings } from '../src/worker/recompute-standings.js'

const { pool, db } = openTestDb()
const COMPETITION_ID = 'apifootball:1:2026'
let A, B, C

// Isolate a clean 3-competitor group: A beats B 2-0, A draws C 1-1, B beats C 3-1.
beforeAll(async () => {
  const comps = await db.select().from(competitor).where(eq(competitor.competitionId, COMPETITION_ID)).limit(3)
  ;[A, B, C] = comps.map((c) => c.code)
  await db.delete(ranking).where(eq(ranking.competitionId, COMPETITION_ID))
  await db.delete(event).where(eq(event.competitionId, COMPETITION_ID))
  const base = { competitionId: COMPETITION_ID, startUtc: new Date('2026-06-13T12:00:00Z'), status: 'final', stage: 'group' }
  await db.insert(event).values([
    { id: 'r1', c1Code: A, c2Code: B, score1: 2, score2: 0, ...base },
    { id: 'r2', c1Code: A, c2Code: C, score1: 1, score2: 1, ...base },
    { id: 'r3', c1Code: B, c2Code: C, score1: 3, score2: 1, ...base },
  ])
})
afterAll(async () => {
  await db.delete(ranking).where(eq(ranking.competitionId, COMPETITION_ID))
  await db.delete(event).where(eq(event.competitionId, COMPETITION_ID))
  await seed(db)
  await pool.end()
})

test('recomputeStandings aggregates W/D/L/GF/GA/PTS from final group results', async () => {
  await recomputeStandings(db, COMPETITION_ID)
  const rows = Object.fromEntries((await db.select().from(ranking).where(eq(ranking.competitionId, COMPETITION_ID))).map((r) => [r.competitorCode, r]))
  expect(rows[A]).toMatchObject({ points: 4, stats: { played: 2, win: 1, draw: 1, loss: 0, gf: 3, ga: 1 } }) // 1W 1D
  expect(rows[B]).toMatchObject({ points: 3, stats: { played: 2, win: 1, draw: 0, loss: 1, gf: 3, ga: 3 } }) // beat C, lost A
  expect(rows[C]).toMatchObject({ points: 1, stats: { played: 2, win: 0, draw: 1, loss: 1, gf: 2, ga: 4 } }) // drew A, lost B
})

test('recomputeStandings ignores non-final and knockout fixtures', async () => {
  await db.insert(event).values([
    { id: 'r4', competitionId: COMPETITION_ID, c1Code: A, c2Code: B, score1: 5, score2: 0, startUtc: new Date('2026-06-20T12:00:00Z'), status: 'live', stage: 'group' },
    { id: 'r5', competitionId: COMPETITION_ID, c1Code: A, c2Code: C, score1: 9, score2: 0, startUtc: new Date('2026-07-01T12:00:00Z'), status: 'final', stage: 'r16' },
  ])
  await recomputeStandings(db, COMPETITION_ID)
  const a = (await db.select().from(ranking).where(and(eq(ranking.competitionId, COMPETITION_ID), eq(ranking.competitorCode, A))))[0]
  expect(a).toMatchObject({ points: 4, stats: { played: 2 } }) // unchanged — live game and knockout excluded
})
