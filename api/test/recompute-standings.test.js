import { expect, test, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event, ranking, bet, support } from '../src/db/schema.js'
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
  // bet/support FK the event they're placed on — clear any leftover rows from other test
  // files before wiping this competition's events, or the delete below violates the FK.
  await db.delete(bet)
  await db.delete(support)
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

test('recomputeStandings is a no-op for non-football competitions', async () => {
  const NBA = 'apibasketball:12:test'
  await db.insert(competition).values({ id: NBA, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'test', format: 'league', name: 'NBA' }).onConflictDoNothing()
  await db.insert(competitor).values([
    { id: `cp_${NBA}_aa`, competitionId: NBA, code: 'aa', name: 'Aa', color: '#111' },
    { id: `cp_${NBA}_bb`, competitionId: NBA, code: 'bb', name: 'Bb', color: '#222' },
  ])
  await db.insert(event).values({ id: 'ev_nba_rc', competitionId: NBA, c1Code: 'aa', c2Code: 'bb', startUtc: new Date(), status: 'final', score1: 100, score2: 90, winnerCode: 'aa', stage: 'group', detail: {} })
  try {
    expect(await recomputeStandings(db, NBA)).toBe(0)
    expect(await db.select().from(ranking).where(eq(ranking.competitionId, NBA))).toHaveLength(0)
  } finally {
    await db.delete(event).where(eq(event.id, 'ev_nba_rc'))
    await db.delete(competitor).where(eq(competitor.competitionId, NBA))
    await db.delete(competition).where(eq(competition.id, NBA))
  }
})
