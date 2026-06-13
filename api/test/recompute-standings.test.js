import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { team, fixture, standing, support, watch } from '../src/db/schema.js'
import { seed } from '../src/seed/seed.js'
import { recomputeStandings } from '../src/worker/recompute-standings.js'

const { pool, db } = openTestDb()
let A, B, C

// Isolate a clean 3-team group: A beats B 2-0, A draws C 1-1, B beats C 3-1.
beforeAll(async () => {
  const teams = await db.select().from(team).limit(3)
  ;[A, B, C] = teams.map((t) => t.code)
  await db.delete(support); await db.delete(watch); await db.delete(standing); await db.delete(fixture)
  const base = { matchday: 1, kickoffUtc: new Date('2026-06-13T12:00:00Z'), venue: 'V', city: 'C', status: 'final', stage: 'group' }
  await db.insert(fixture).values([
    { id: 'r1', group: 'A', t1Code: A, t2Code: B, score1: 2, score2: 0, ...base },
    { id: 'r2', group: 'A', t1Code: A, t2Code: C, score1: 1, score2: 1, ...base },
    { id: 'r3', group: 'A', t1Code: B, t2Code: C, score1: 3, score2: 1, ...base },
  ])
})
afterAll(async () => { await db.delete(fixture); await db.delete(standing); await seed(db); await pool.end() })

test('recomputeStandings aggregates W/D/L/GF/GA/PTS from final group results', async () => {
  await recomputeStandings(db)
  const rows = Object.fromEntries((await db.select().from(standing)).map((s) => [s.teamCode, s]))
  expect(rows[A]).toMatchObject({ played: 2, win: 1, draw: 1, loss: 0, gf: 3, ga: 1, pts: 4 }) // 1W 1D
  expect(rows[B]).toMatchObject({ played: 2, win: 1, draw: 0, loss: 1, gf: 3, ga: 3, pts: 3 }) // beat C, lost A
  expect(rows[C]).toMatchObject({ played: 2, win: 0, draw: 1, loss: 1, gf: 2, ga: 4, pts: 1 }) // drew A, lost B
})

test('recomputeStandings ignores non-final and knockout fixtures', async () => {
  await db.insert(fixture).values([
    { id: 'r4', group: 'A', t1Code: A, t2Code: B, score1: 5, score2: 0, matchday: 2, kickoffUtc: new Date('2026-06-20T12:00:00Z'), venue: 'V', city: 'C', status: 'live', stage: 'group' },
    { id: 'r5', group: 'A', t1Code: A, t2Code: C, score1: 9, score2: 0, matchday: 9, kickoffUtc: new Date('2026-07-01T12:00:00Z'), venue: 'V', city: 'C', status: 'final', stage: 'r16' },
  ])
  await recomputeStandings(db)
  const a = (await db.select().from(standing).where(eq(standing.teamCode, A)))[0]
  expect(a).toMatchObject({ played: 2, pts: 4 }) // unchanged — live game and knockout excluded
})
