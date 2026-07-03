import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event, ranking, syncLog, support } from '../src/db/schema.js'
import { flattenEvent } from '../src/db/event-shape.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { mapPrediction } from '../src/providers/mapping.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'
import { syncCompetitors } from '../src/worker/sync-competitors.js'
import { seed } from '../src/seed/seed.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()
const COMPETITION_ID = 'apifootball:1:2026'
const FOOTBALL_COMP = { id: 'apifootball:1:2026', provider: 'apifootball', sport: 'football', leagueId: '1', season: '2026' }
const NBA_COMP = { id: 'apibasketball:12:2023-2024', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024' }

const provider = createRecordedProvider({
  fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams'),
})

beforeAll(async () => {
  // wire crosswalk: hr→3001, be→3002, gh→3003 (matches recorded JSON)
  await db.update(competitor).set({ providerId: 3001 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'hr')))
  await db.update(competitor).set({ providerId: 3002 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'be')))
  await db.update(competitor).set({ providerId: 3003 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'gh')))
})
// This suite prunes `event` (competition-scoped) down to the provider set; restore the
// Phase-1 seed afterwards so other test files (which depend on the global seed) still pass.
afterAll(async () => {
  await db.delete(event)
  await db.delete(ranking)
  await seed(db)
  await pool.end()
})

test('refuses to sync when an incoming fixture id is already owned by a different competition', async () => {
  const OTHER_COMP = { id: 'apifootball:999:2026', provider: 'apifootball', sport: 'football', leagueId: '999', season: '2026' }
  await db.insert(competition).values({ ...OTHER_COMP, format: 'league', name: 'Other Comp' }).onConflictDoNothing()
  await db.insert(competitor).values({ id: `${OTHER_COMP.id}:x1`, competitionId: OTHER_COMP.id, code: 'x1', name: 'X1', color: '#111' }).onConflictDoNothing()
  await db.insert(competitor).values({ id: `${OTHER_COMP.id}:x2`, competitionId: OTHER_COMP.id, code: 'x2', name: 'X2', color: '#222' }).onConflictDoNothing()
  // 9001 is a fixture id the football recorded provider will report below — plant it under a
  // different competition first so syncBaseline sees a cross-competition id collision.
  await db.insert(event).values({
    id: '9001', competitionId: OTHER_COMP.id, c1Code: 'x1', c2Code: 'x2',
    startUtc: new Date(), status: 'upcoming', detail: {},
  }).onConflictDoNothing()
  try {
    await expect(syncBaseline(db, provider, FOOTBALL_COMP)).rejects.toThrow(/already owned by competition/)
    const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
    expect(logs.at(-1).status).toBe('error')
    expect(logs.at(-1).error).toMatch(/already owned by competition/)
  } finally {
    await db.delete(event).where(eq(event.id, '9001'))
    await db.delete(competitor).where(eq(competitor.competitionId, OTHER_COMP.id))
    await db.delete(competition).where(eq(competition.id, OTHER_COMP.id))
  }
})

test('baseline sync upserts provider fixtures, prunes seed fixtures, logs ok', async () => {
  const r = await syncBaseline(db, provider, FOOTBALL_COMP)
  expect(r.newlyFinal).toEqual(expect.any(Array))
  const fx = (await db.select().from(event)).map(flattenEvent)
  const ids = fx.map((f) => f.id).sort()
  expect(ids).toEqual(['9001', '9002'])            // seeded m0..m71 pruned; provider fixtures present
  const f1 = fx.find((f) => f.id === '9001')
  expect(f1).toMatchObject({ t1Code: 'hr', t2Code: 'be', status: 'final', score1: 2, score2: 1, group: 'L', matchday: 1 })
  expect(f1.probA).toBe(55)                        // predictions applied
  expect(r.newlyFinal).toContain('9001')           // fixture 9001 is final on this (first) sync
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('ok')
})

test('prunes a stale event even when it has support rows (no FK error)', async () => {
  await db.insert(event).values({ id: 'stale1', competitionId: COMPETITION_ID, c1Code: 'hr', c2Code: 'be', startUtc: new Date(), status: 'upcoming', detail: { group: 'L', matchday: 1, venue: 'V', city: 'C' } }).onConflictDoNothing()
  await db.insert(support).values({ sweepId: 'default', fixtureId: 'stale1', personId: 'p4', teamCode: 'hr' }).onConflictDoNothing()
  // the provider only knows 9001/9002, so stale1 must be pruned along with its social rows
  await syncBaseline(db, provider, FOOTBALL_COMP)
  expect((await db.select().from(event).where(eq(event.id, 'stale1'))).length).toBe(0)
  expect((await db.select().from(support).where(eq(support.fixtureId, 'stale1'))).length).toBe(0)
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('ok')
})

test('is idempotent — second run changes nothing structural', async () => {
  const r = await syncBaseline(db, provider, FOOTBALL_COMP)
  expect((await db.select().from(event)).length).toBe(2)
  expect(r.newlyFinal).toEqual([]) // 9001 was already final from the prior sync — not newly final again
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
  await syncBaseline(db, oddsProvider, FOOTBALL_COMP)
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
  await syncBaseline(db, boomProbs, FOOTBALL_COMP)
  const f2 = flattenEvent((await db.select().from(event).where(eq(event.id, '9002')))[0])
  expect(f2.probA).toBe(50)                                       // last-good odds untouched
})

test('a provider failure leaves last-good data and logs an error row', async () => {
  const boom = { ...provider, async fetchSchedule() { throw new Error('upstream 503') } }
  await expect(syncBaseline(db, boom, FOOTBALL_COMP)).rejects.toThrow(/503/)
  expect((await db.select().from(event)).length).toBe(2) // unchanged
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('error')
  expect(logs.at(-1).error).toMatch(/503/)
})

test('persists markets + htScore and winnerCode when fixture is final', async () => {
  // Arrange: override fetchSchedule to inject winnerSide:'home' + htScore into fixture 9001 (Croatia won)
  // and fetchOdds to return Pinnacle markets for 9001.
  const pinnacleOddsProvider = {
    ...provider,
    async fetchSchedule(comp) {
      const base = await provider.fetchSchedule(comp)
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
  await syncBaseline(db, pinnacleOddsProvider, FOOTBALL_COMP)
  const [row] = await db.select().from(event).where(eq(event.id, '9001'))
  const f = flattenEvent(row)
  expect(f.markets['1x2'].selections[0].odds).toBe(2)
  expect(f.probA).toBe(50)
  expect(f.htScore1).toBe(1)
  expect(f.winnerCode).toBe(f.t1Code) // winnerSide 'home' → t1Code ('hr')
})

test('NBA baseline: drops All-Star game, writes 2-way finals + conference rankings, reports newlyFinal', async () => {
  const provider = createRecordedBasketballProvider({
    leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings'),
  })
  await db.insert(competition).values({ ...NBA_COMP, format: 'league', name: 'NBA' }).onConflictDoNothing()
  await syncCompetitors(db, provider, NBA_COMP)
  try {
    const r = await syncBaseline(db, provider, NBA_COMP)
    expect(r.fixtures).toBe(5) // 6 recorded − All-Star (East/West unknown teams dropped)
    expect(r.newlyFinal).toHaveLength(5)
    const evs = await db.select().from(event).where(eq(event.competitionId, NBA_COMP.id))
    expect(evs).toHaveLength(5)
    for (const ev of evs) {
      expect(ev.status).toBe('final')
      expect([ev.c1Code, ev.c2Code]).toContain(ev.winnerCode) // 2-way: winner is always a competitor, never 'DRAW'
    }
    const aot = evs.find((ev) => ev.id === '372190')
    expect(aot.detail.ot).not.toBeNull()
    expect(aot.detail.quarters.home).toHaveLength(4)
    const rows = await db.select().from(ranking).where(eq(ranking.competitionId, NBA_COMP.id))
    expect(rows).toHaveLength(30)
    const withRank = rows.filter((x) => x.rank != null)
    expect(withRank).toHaveLength(30) // conference positions land in ranking.rank
    expect(rows[0].stats).toHaveProperty('pct')
  } finally {
    // teardown so later test files see only the Phase-1 seed
    await db.delete(event).where(eq(event.competitionId, NBA_COMP.id))
    await db.delete(ranking).where(eq(ranking.competitionId, NBA_COMP.id))
    await db.delete(competitor).where(eq(competitor.competitionId, NBA_COMP.id))
    await db.delete(competition).where(eq(competition.id, NBA_COMP.id))
  }
})
