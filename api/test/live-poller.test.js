import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk, fixture, standing } from '../src/db/schema.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'
import { pollLive, isLiveWindow, pollLineups, isLineupWindow } from '../src/worker/live-poller.js'
import { resolveCrosswalk } from '../src/worker/crosswalk.js'
import { seed } from '../src/seed/seed.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()

beforeAll(async () => {
  for (const [code, id] of [['hr', 3001], ['be', 3002], ['gh', 3003]]) {
    await db.update(teamCrosswalk).set({ providerTeamId: id }).where(eq(teamCrosswalk.teamCode, code))
  }
  await syncBaseline(db, createRecordedProvider({ fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams') }), { season: 2026 })
})
// beforeAll prunes the shared fixture table to the provider set; restore the Phase-1
// seed afterwards so other test files (which depend on the global seed) still pass.
afterAll(async () => {
  await db.delete(fixture)
  await db.delete(standing)
  await seed(db)
  await pool.end()
})

test('isLiveWindow is true within ±N minutes of any kickoff', () => {
  const kickoffs = [new Date('2026-06-16T09:00:00Z')]
  expect(isLiveWindow(new Date('2026-06-16T09:30:00Z'), kickoffs, 150)).toBe(true)   // 30m after KO
  expect(isLiveWindow(new Date('2026-06-16T08:55:00Z'), kickoffs, 150)).toBe(true)   // 5m before KO
  expect(isLiveWindow(new Date('2026-06-16T13:00:00Z'), kickoffs, 150)).toBe(false)  // 4h after → idle
})

test('pollLive updates score/minute/status for in-play fixtures only', async () => {
  const liveProvider = createRecordedProvider({ live: load('fixtures-live') }) // fixture 9002 now 2H 63' 1-0
  const n = await pollLive(db, liveProvider)
  expect(n).toBe(1)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9002')))[0]
  expect(f).toMatchObject({ status: 'live', minute: 63, score1: 1, score2: 0 })
  const other = (await db.select().from(fixture).where(eq(fixture.id, '9001')))[0]
  expect(other.status).toBe('final') // untouched
})

test('pollLive publishes a score event for each updated fixture', async () => {
  const liveProvider = createRecordedProvider({ live: load('fixtures-live') }) // fixture 9002 → 2H 63' 1-0
  const events = []
  await pollLive(db, liveProvider, (e) => events.push(e))
  expect(events).toContainEqual({ type: 'score', fixtureId: '9002', status: 'live', score: [1, 0], minute: 63 })
})

test('isLineupWindow is true ~45 min before kickoff (longer lead than scores)', () => {
  const kickoffs = [new Date('2026-06-16T09:00:00Z')]
  expect(isLineupWindow(new Date('2026-06-16T08:20:00Z'), kickoffs)).toBe(true)   // 40m before KO
  expect(isLineupWindow(new Date('2026-06-16T08:05:00Z'), kickoffs)).toBe(false)  // 55m before → too early
  expect(isLineupWindow(new Date('2026-06-16T09:30:00Z'), kickoffs)).toBe(true)   // 30m into match
})

test('pollLineups stores 2-team lineups and publishes a lineups event', async () => {
  await db.update(fixture).set({ lineups: null }).where(eq(fixture.id, '9001'))
  const crosswalk = await resolveCrosswalk(db)
  const provider = createRecordedProvider({ lineups: load('lineups') })
  const rows = await db.select().from(fixture).where(eq(fixture.id, '9001'))
  const events = []
  const n = await pollLineups(db, provider, rows, crosswalk, (e) => events.push(e))
  expect(n).toBe(1)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9001')))[0]
  expect(f.lineups).toHaveLength(2)
  expect(f.lineups[0]).toMatchObject({ teamCode: 'hr', formation: '4-3-3' })
  expect(f.lineups[0].startXI).toHaveLength(11)
  expect(events).toContainEqual({ type: 'lineups', fixtureId: '9001' })
})

test('pollLineups skips fixtures that already have a team sheet', async () => {
  const sentinel = [{ teamCode: 'hr', formation: 'X', startXI: [] }]
  await db.update(fixture).set({ lineups: sentinel }).where(eq(fixture.id, '9001'))
  let called = 0
  const provider = { async fetchLineups() { called++; return load('lineups') } }
  const rows = await db.select().from(fixture).where(eq(fixture.id, '9001'))
  await pollLineups(db, provider, rows, await resolveCrosswalk(db))
  expect(called).toBe(0)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9001')))[0]
  expect(f.lineups).toEqual(sentinel)
})

test('pollLineups is best-effort: a failed fetch updates nothing and never throws', async () => {
  await db.update(fixture).set({ lineups: null }).where(eq(fixture.id, '9002'))
  const provider = { async fetchLineups() { throw new Error('lineups 503') } }
  const rows = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  const n = await pollLineups(db, provider, rows, await resolveCrosswalk(db))
  expect(n).toBe(0)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9002')))[0]
  expect(f.lineups).toBeNull()
})
