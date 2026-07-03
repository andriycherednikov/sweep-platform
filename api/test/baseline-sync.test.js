import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk, competitor, fixture, standing, event, ranking, syncLog, support } from '../src/db/schema.js'
import { flattenEvent } from '../src/db/event-shape.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { mapPrediction } from '../src/providers/mapping.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'
import { seed } from '../src/seed/seed.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()
const COMPETITION_ID = 'apifootball:1:2026'

const provider = createRecordedProvider({
  fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams'),
})

beforeAll(async () => {
  // wire crosswalk: hr→3001, be→3002, gh→3003 (matches recorded JSON)
  await db.update(teamCrosswalk).set({ providerTeamId: 3001 }).where(eq(teamCrosswalk.teamCode, 'hr'))
  await db.update(teamCrosswalk).set({ providerTeamId: 3002 }).where(eq(teamCrosswalk.teamCode, 'be'))
  await db.update(teamCrosswalk).set({ providerTeamId: 3003 }).where(eq(teamCrosswalk.teamCode, 'gh'))
  await db.update(competitor).set({ providerId: 3001 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'hr')))
  await db.update(competitor).set({ providerId: 3002 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'be')))
  await db.update(competitor).set({ providerId: 3003 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'gh')))
})
// This suite prunes `event` (competition-scoped) down to the provider set; restore the
// Phase-1 seed afterwards so other test files (which depend on the global seed) still pass.
// fixture/standing are untouched by syncBaseline now but 'stale1' below dual-inserts a
// fixture row too (bet/support.fixtureId still FKs fixture.id — swap task repoints it),
// so clean those up as well.
afterAll(async () => {
  await db.delete(fixture)
  await db.delete(standing)
  await db.delete(event)
  await db.delete(ranking)
  await seed(db)
  await pool.end()
})

test('baseline sync upserts provider fixtures, prunes seed fixtures, logs ok', async () => {
  await syncBaseline(db, provider, { season: 2026, competitionId: COMPETITION_ID })
  const fx = (await db.select().from(event)).map(flattenEvent)
  const ids = fx.map((f) => f.id).sort()
  expect(ids).toEqual(['9001', '9002'])            // seeded m0..m71 pruned; provider fixtures present
  const f1 = fx.find((f) => f.id === '9001')
  expect(f1).toMatchObject({ t1Code: 'hr', t2Code: 'be', status: 'final', score1: 2, score2: 1, group: 'L', matchday: 1 })
  expect(f1.probA).toBe(55)                        // predictions applied
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('ok')
})

test('prunes a stale event even when it has support rows (no FK error)', async () => {
  // support/bet.fixtureId still FKs fixture.id (swap task repoints it) — dual-insert so the
  // FK is satisfied while the prune target (event, competition-scoped) is what's under test.
  await db.insert(fixture).values({ id: 'stale1', group: 'L', matchday: 1, t1Code: 'hr', t2Code: 'be', kickoffUtc: new Date(), venue: 'V', city: 'C', status: 'upcoming' }).onConflictDoNothing()
  await db.insert(event).values({ id: 'stale1', competitionId: COMPETITION_ID, c1Code: 'hr', c2Code: 'be', startUtc: new Date(), status: 'upcoming', detail: { group: 'L', matchday: 1, venue: 'V', city: 'C' } }).onConflictDoNothing()
  await db.insert(support).values({ sweepId: 'default', fixtureId: 'stale1', personId: 'p4', teamCode: 'hr' }).onConflictDoNothing()
  // the provider only knows 9001/9002, so stale1 must be pruned along with its social rows
  await syncBaseline(db, provider, { season: 2026, competitionId: COMPETITION_ID })
  expect((await db.select().from(event).where(eq(event.id, 'stale1'))).length).toBe(0)
  expect((await db.select().from(support).where(eq(support.fixtureId, 'stale1'))).length).toBe(0)
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('ok')
})

test('is idempotent — second run changes nothing structural', async () => {
  await syncBaseline(db, provider, { season: 2026, competitionId: COMPETITION_ID })
  expect((await db.select().from(event)).length).toBe(2)
  const cro = (await db.select().from(ranking).where(and(eq(ranking.competitionId, COMPETITION_ID), eq(ranking.competitorCode, 'hr'))))[0]
  expect(cro.points).toBe(3)
  expect(cro.stats).toMatchObject({ played: 1, win: 1, gf: 2, ga: 1 })
})

test('prefers bookmaker odds, falls back to predictions when odds are absent', async () => {
  const calls = { preds: [] }
  const oddsProvider = {
    ...provider,
    async fetchOdds(fixtureId) {
      if (fixtureId !== '9002') return null
      return { markets: { '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [
        { key: 'HOME', label: 'Home', odds: 2 }, { key: 'DRAW', label: 'Draw', odds: 3.5 }, { key: 'AWAY', label: 'Away', odds: 4 },
      ] } }, book: 'Pinnacle', prob: { a: 50, d: 25, b: 25 } }
    },
    async fetchPredictions(fixtureId) { calls.preds.push(fixtureId); return mapPrediction(load('predictions')) },
  }
  await syncBaseline(db, oddsProvider, { season: 2026, competitionId: COMPETITION_ID })
  const fx = (await db.select().from(event)).map(flattenEvent)
  const f1 = fx.find((f) => f.id === '9001')
  const f2 = fx.find((f) => f.id === '9002')
  expect(f2).toMatchObject({ probA: 50, probD: 25, probB: 25 })   // odds-derived
  expect(f2.probA + f2.probD + f2.probB).toBe(100)
  expect(f1.probA).toBe(55)                                       // no odds → predictions fallback
  expect(calls.preds).not.toContain('9002')                      // odds won → predictions skipped
  expect(calls.preds).toContain('9001')                          // no odds → predictions tried
})

test('a failed odds+predictions fetch does not wipe prior prob', async () => {
  const boomProbs = {
    ...provider,
    async fetchOdds() { throw new Error('odds 503') },
    async fetchPredictions() { throw new Error('preds 503') },
  }
  await syncBaseline(db, boomProbs, { season: 2026, competitionId: COMPETITION_ID })
  const f2 = flattenEvent((await db.select().from(event).where(eq(event.id, '9002')))[0])
  expect(f2.probA).toBe(50)                                       // last-good odds untouched
})

test('a provider failure leaves last-good data and logs an error row', async () => {
  const boom = { ...provider, async fetchFixtures() { throw new Error('upstream 503') } }
  await expect(syncBaseline(db, boom, { season: 2026, competitionId: COMPETITION_ID })).rejects.toThrow(/503/)
  expect((await db.select().from(event)).length).toBe(2) // unchanged
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('error')
  expect(logs.at(-1).error).toMatch(/503/)
})

test('persists markets + htScore and winnerCode when fixture is final', async () => {
  // Arrange: override fetchFixtures to inject winnerSide:'home' + htScore into fixture 9001 (Croatia won)
  // and fetchOdds to return Pinnacle markets for 9001.
  const pinnacleOddsProvider = {
    ...provider,
    async fetchFixtures(season) {
      const base = await provider.fetchFixtures(season)
      return base.map((f) => f.id === '9001' ? { ...f, winnerSide: 'home', htScore1: 1, htScore2: 0 } : f)
    },
    async fetchOdds(fixtureId) {
      if (fixtureId === '9001') {
        return { markets: { '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [
          { key: 'HOME', label: 'Home', odds: 2 }, { key: 'DRAW', label: 'Draw', odds: 3.5 }, { key: 'AWAY', label: 'Away', odds: 4 },
        ] } }, book: 'Pinnacle', prob: { a: 50, d: 25, b: 25 } }
      }
      return null
    },
  }
  await syncBaseline(db, pinnacleOddsProvider, { season: 2026, competitionId: COMPETITION_ID })
  const [row] = await db.select().from(event).where(eq(event.id, '9001'))
  const f = flattenEvent(row)
  expect(f.markets['1x2'].selections[0].odds).toBe(2)
  expect(f.probA).toBe(50)
  expect(f.htScore1).toBe(1)
  expect(f.winnerCode).toBe(f.t1Code) // winnerSide 'home' → t1Code ('hr')
})
