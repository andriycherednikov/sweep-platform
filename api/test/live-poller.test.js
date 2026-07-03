import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk, competitor, fixture, standing, event, ranking } from '../src/db/schema.js'
import { flattenEvent } from '../src/db/event-shape.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'
import { pollLive, isLiveWindow, pollLineups, isLineupWindow, fixturesToPoll, pollEvents, pollStatistics, backfillFinalStatistics, backfillFinalEvents } from '../src/worker/live-poller.js'
import { resolveCrosswalk } from '../src/worker/crosswalk.js'
import { seed } from '../src/seed/seed.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()
const COMPETITION_ID = 'apifootball:1:2026'

beforeAll(async () => {
  for (const [code, id] of [['hr', 3001], ['be', 3002], ['gh', 3003]]) {
    await db.update(teamCrosswalk).set({ providerTeamId: id }).where(eq(teamCrosswalk.teamCode, code))
    await db.update(competitor).set({ providerId: id }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, code)))
  }
  await syncBaseline(db, createRecordedProvider({ fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams') }), { season: 2026, competitionId: COMPETITION_ID })
  // live-poller.js itself still reads/writes the `fixture` table (ported in the next task);
  // baseline sync no longer writes it, so mirror the synced events into `fixture` here —
  // a test-only bridge that goes away once live-poller.test.js is re-keyed onto `event`.
  const synced = (await db.select().from(event).where(eq(event.competitionId, COMPETITION_ID))).map(flattenEvent)
  for (const f of synced) {
    await db.insert(fixture).values({
      id: f.id, group: f.group, matchday: f.matchday, t1Code: f.t1Code, t2Code: f.t2Code,
      kickoffUtc: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
      score1: f.score1, score2: f.score2, minute: f.minute, phase: f.phase,
      probA: f.probA, probD: f.probD, probB: f.probB, markets: f.markets, winnerCode: f.winnerCode,
      htScore1: f.htScore1, htScore2: f.htScore2, regScore1: f.regScore1, regScore2: f.regScore2,
      penScore1: f.penScore1, penScore2: f.penScore2, stage: f.stage,
      derby: f.derby, doubleOwner: f.doubleOwner,
    }).onConflictDoNothing()
  }
})
// beforeAll prunes `event` (competition-scoped) and mirrors it into `fixture`; restore the
// Phase-1 seed for both afterwards so other test files (which depend on the global seed) still pass.
afterAll(async () => {
  await db.delete(fixture)
  await db.delete(standing)
  await db.delete(event)
  await db.delete(ranking)
  await seed(db)
  await pool.end()
})

test('isLiveWindow is true within ±N minutes of any kickoff', () => {
  const kickoffs = [new Date('2026-06-16T09:00:00Z')]
  expect(isLiveWindow(new Date('2026-06-16T09:30:00Z'), kickoffs, 150)).toBe(true)   // 30m after KO
  expect(isLiveWindow(new Date('2026-06-16T08:55:00Z'), kickoffs, 150)).toBe(true)   // 5m before KO
  expect(isLiveWindow(new Date('2026-06-16T13:00:00Z'), kickoffs, 150)).toBe(false)  // 4h after → idle
})

test('pollLive updates status/score/minute for the polled fixtures (by id)', async () => {
  await db.update(fixture).set({ status: 'upcoming', score1: null, score2: null, minute: null }).where(eq(fixture.id, '9002'))
  const provider = createRecordedProvider({ fixtures: load('fixtures-live') }) // 9002 → 2H 63' 1-0
  const n = await pollLive(db, provider, ['9001', '9002'])
  expect(n).toBe(1)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9002')))[0]
  expect(f).toMatchObject({ status: 'live', minute: 63, score1: 1, score2: 0 })
})

test('pollLive publishes a score event for each changed fixture', async () => {
  await db.update(fixture).set({ status: 'upcoming', score1: null, score2: null, minute: null }).where(eq(fixture.id, '9002'))
  const provider = createRecordedProvider({ fixtures: load('fixtures-live') })
  const events = []
  await pollLive(db, provider, ['9002'], (e) => events.push(e))
  expect(events).toContainEqual({ type: 'score', fixtureId: '9002', status: 'live', score: [1, 0], minute: 63, phase: '2H' })
})

test('pollLive finalizes a match that has ended — the key fix vs live=all', async () => {
  await db.update(fixture).set({ status: 'live', score1: 1, score2: 0, minute: 90, winnerCode: null }).where(eq(fixture.id, '9002'))
  // id polling still returns the fixture once it's FT (live=all would have dropped it)
  const provider = { async fetchFixturesByIds(ids) { return ids.includes('9002') ? [{ id: '9002', status: 'final', score1: 2, score2: 0, minute: null, winnerSide: 'home' }] : [] } }
  const events = []
  const n = await pollLive(db, provider, ['9002'], (e) => events.push(e))
  expect(n).toBe(1)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9002')))[0]
  expect(f).toMatchObject({ status: 'final', score1: 2, score2: 0, winnerCode: 'hr' })
  expect(events).toContainEqual({ type: 'score', fixtureId: '9002', status: 'final', score: [2, 0], minute: null, phase: null })
})

test('pollLive persists winnerCode and shootout score on penalty final', async () => {
  await db.update(fixture).set({ status: 'live', score1: 1, score2: 1, minute: 120, winnerCode: null, penScore1: null, penScore2: null }).where(eq(fixture.id, '9002'))
  const provider = { async fetchFixturesByIds(ids) { return ids.includes('9002') ? [{ id: '9002', status: 'final', score1: 1, score2: 1, minute: null, winnerSide: 'away', penScore1: 3, penScore2: 5 }] : [] } }
  const n = await pollLive(db, provider, ['9002'])
  expect(n).toBe(1)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9002')))[0]
  expect(f).toMatchObject({ status: 'final', score1: 1, score2: 1, winnerCode: 'gh', penScore1: 3, penScore2: 5 })
})

test('pollLive makes no update and publishes nothing when nothing changed', async () => {
  await db.update(fixture).set({ status: 'upcoming', score1: null, score2: null, minute: null, winnerCode: null, penScore1: null, penScore2: null }).where(eq(fixture.id, '9002'))
  const provider = { async fetchFixturesByIds() { return [{ id: '9002', status: 'upcoming', score1: null, score2: null, minute: null }] } }
  const events = []
  const n = await pollLive(db, provider, ['9002'], (e) => events.push(e))
  expect(n).toBe(0)
  expect(events).toEqual([])
})

test('pollLive does nothing (no fetch) when there are no in-window ids', async () => {
  let called = 0
  const provider = { async fetchFixturesByIds() { called++; return [] } }
  const n = await pollLive(db, provider, [])
  expect(n).toBe(0)
  expect(called).toBe(0)
})

test('fixturesToPoll: in-window fixtures plus stale-recovery (missed kickoffs / stuck live)', () => {
  const now = new Date('2026-06-12T12:00:00Z')
  const at = (mins) => new Date(now.getTime() + mins * 60_000).toISOString()
  const rows = [
    { id: 'a', ko: at(-30), status: 'live' },      // genuinely live, in window → poll
    { id: 'b', ko: at(-200), status: 'live' },     // stuck live past the window → recover
    { id: 'c', ko: at(-200), status: 'upcoming' }, // kickoff missed (worker was down) → recover
    { id: 'd', ko: at(-200), status: 'final' },    // already final → skip
    { id: 'e', ko: at(300), status: 'upcoming' },  // far future → skip
    { id: 'f', ko: at(-5), status: 'upcoming' },   // just kicked off, in window → poll
    { id: 'g', ko: at(-60 * 30), status: 'upcoming' }, // 30h ago, beyond recovery → baseline handles
  ]
  expect(fixturesToPoll(rows, now).sort()).toEqual(['a', 'b', 'c', 'f'])
})

test('isLineupWindow is true ~45 min before kickoff (longer lead than scores)', () => {
  const kickoffs = [new Date('2026-06-16T09:00:00Z')]
  expect(isLineupWindow(new Date('2026-06-16T08:20:00Z'), kickoffs)).toBe(true)   // 40m before KO
  expect(isLineupWindow(new Date('2026-06-16T08:05:00Z'), kickoffs)).toBe(false)  // 55m before → too early
  expect(isLineupWindow(new Date('2026-06-16T09:30:00Z'), kickoffs)).toBe(true)   // 30m into match
})

test('pollLineups stores 2-team lineups and publishes a lineups event', async () => {
  await db.update(fixture).set({ lineups: null }).where(eq(fixture.id, '9001'))
  const crosswalk = await resolveCrosswalk(db, COMPETITION_ID)
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
  await pollLineups(db, provider, rows, await resolveCrosswalk(db, COMPETITION_ID))
  expect(called).toBe(0)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9001')))[0]
  expect(f.lineups).toEqual(sentinel)
})

test('pollLineups is best-effort: a failed fetch updates nothing and never throws', async () => {
  await db.update(fixture).set({ lineups: null }).where(eq(fixture.id, '9002'))
  const provider = { async fetchLineups() { throw new Error('lineups 503') } }
  const rows = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  const n = await pollLineups(db, provider, rows, await resolveCrosswalk(db, COMPETITION_ID))
  expect(n).toBe(0)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9002')))[0]
  expect(f.lineups).toBeNull()
})

const goalRaw = (over = {}) => ({ time: { elapsed: 23, extra: null }, team: { id: 3001 }, player: { name: 'Modric' }, assist: { name: null }, type: 'Goal', detail: 'Normal Goal', ...over })
const cardRaw = (over = {}) => ({ time: { elapsed: 30, extra: null }, team: { id: 3002 }, player: { name: 'Lukaku' }, type: 'Card', detail: 'Yellow Card', ...over })
const eventsProvider = (list) => ({ async fetchEvents() { return { response: list } } })

test('pollEvents baselines silently when events is null (no backfill spam)', async () => {
  await db.update(fixture).set({ events: null, score1: 0, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const emitted = []
  const n = await pollEvents(db, eventsProvider([goalRaw()]), ['9002'], xw, (e) => emitted.push(e))
  expect(n).toBe(0)
  expect(emitted).toEqual([])
  const [row] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(row.events).toHaveLength(1) // baseline persisted, just not announced
})

test('pollEvents emits only newly-appearing goal/card events and carries the score on goals', async () => {
  await db.update(fixture).set({ events: [], score1: 1, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const emitted = []
  const n = await pollEvents(db, eventsProvider([goalRaw(), cardRaw(), { type: 'subst', team: { id: 3001 }, time: { elapsed: 70 }, player: { name: 'x' }, detail: 's' }]), ['9002'], xw, (e) => emitted.push(e))
  expect(n).toBe(2) // subst ignored
  expect(emitted).toContainEqual({ type: 'goal', fixtureId: '9002', teamCode: 'hr', player: 'Modric', assist: null, minute: 23, detail: 'Normal Goal', score: [1, 0] })
  expect(emitted).toContainEqual({ type: 'card', fixtureId: '9002', teamCode: 'be', player: 'Lukaku', minute: 30, card: 'yellow', detail: 'Yellow Card' })
})

test('pollEvents emits nothing when the event list is unchanged', async () => {
  await db.update(fixture).set({ events: [], score1: 0, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const provider = eventsProvider([goalRaw()])
  await pollEvents(db, provider, ['9002'], xw, () => {})   // first non-null poll: emits the goal
  const emitted = []
  const n = await pollEvents(db, provider, ['9002'], xw, (e) => emitted.push(e)) // same list again
  expect(n).toBe(0)
  expect(emitted).toEqual([])
})

test('pollEvents isolates a per-fixture fetch error', async () => {
  await db.update(fixture).set({ events: [], score1: 0, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const provider = { async fetchEvents() { throw new Error('boom') } }
  const n = await pollEvents(db, provider, ['9002'], xw, () => {})
  expect(n).toBe(0) // swallowed, no throw
})

const statsRaw = (h, a) => [
  { team: { id: 3001 }, statistics: [{ type: 'Shots on Goal', value: h.sog }, { type: 'Ball Possession', value: h.pos }, { type: 'Fouls', value: h.f }] },
  { team: { id: 3002 }, statistics: [{ type: 'Shots on Goal', value: a.sog }, { type: 'Ball Possession', value: a.pos }, { type: 'Fouls', value: a.f }] },
]
const statsProvider = (list) => ({ async fetchStatistics() { return { response: list } } })

test('pollStatistics stores a per-team snapshot keyed by team code', async () => {
  await db.update(fixture).set({ statistics: null }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const n = await pollStatistics(db, statsProvider(statsRaw({ sog: 5, pos: '58%', f: 9 }, { sog: 2, pos: '42%', f: 14 })), ['9002'], xw)
  expect(n).toBe(1)
  const [row] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(row.statistics).toEqual({ hr: { shotsOnGoal: 5, possession: '58%', fouls: 9 }, be: { shotsOnGoal: 2, possession: '42%', fouls: 14 } })
})

test('pollStatistics is a no-op (no write) when the snapshot is unchanged', async () => {
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const provider = statsProvider(statsRaw({ sog: 1, pos: '50%', f: 1 }, { sog: 1, pos: '50%', f: 1 }))
  await pollStatistics(db, provider, ['9002'], xw)
  const n = await pollStatistics(db, provider, ['9002'], xw)
  expect(n).toBe(0)
})

test('pollStatistics keeps a prior snapshot when nothing is published yet', async () => {
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  await pollStatistics(db, statsProvider(statsRaw({ sog: 3, pos: '55%', f: 5 }, { sog: 4, pos: '45%', f: 6 })), ['9002'], xw)
  const n = await pollStatistics(db, statsProvider([]), ['9002'], xw) // empty response → null map, no overwrite
  expect(n).toBe(0)
  const [row] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(row.statistics.hr.shotsOnGoal).toBe(3)
})

test('pollStatistics merges a one-team response into the existing snapshot (no wipe)', async () => {
  await db.update(fixture).set({ statistics: null }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  await pollStatistics(db, statsProvider(statsRaw({ sog: 3, pos: '55%', f: 5 }, { sog: 4, pos: '45%', f: 6 })), ['9002'], xw)
  // a later poll only returns the home team — must not drop the away team's stats
  const onlyHome = statsProvider([{ team: { id: 3001 }, statistics: [{ type: 'Shots on Goal', value: 7 }] }])
  const n = await pollStatistics(db, onlyHome, ['9002'], xw)
  expect(n).toBe(1)
  const [row] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(row.statistics.hr.shotsOnGoal).toBe(7)  // home updated
  expect(row.statistics.be).toEqual({ shotsOnGoal: 4, possession: '45%', fouls: 6 }) // away preserved
})

test('pollStatistics isolates a per-fixture fetch error', async () => {
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const n = await pollStatistics(db, { async fetchStatistics() { throw new Error('boom') } }, ['9002'], xw)
  expect(n).toBe(0)
})

test('backfillFinalStatistics fills the most recent finals missing stats, respecting the limit', async () => {
  await db.update(fixture).set({ statistics: {} }) // everything else already has a (non-null) snapshot
  await db.update(fixture).set({ status: 'final', statistics: null, kickoffUtc: new Date('2026-06-20T00:00:00Z') }).where(eq(fixture.id, '9002'))
  await db.update(fixture).set({ status: 'final', statistics: null, kickoffUtc: new Date('2026-06-10T00:00:00Z') }).where(eq(fixture.id, '9001'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const res = await backfillFinalStatistics(db, statsProvider(statsRaw({ sog: 3, pos: '55%', f: 5 }, { sog: 4, pos: '45%', f: 6 })), xw, { limit: 1 })
  expect(res).toEqual({ checked: 1, updated: 1 }) // newest-first → only 9002
  const [f2] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(f2.statistics.hr.shotsOnGoal).toBe(3)
  const [f1] = await db.select().from(fixture).where(eq(fixture.id, '9001'))
  expect(f1.statistics).toBeNull() // beyond the limit → untouched
})

test('backfillFinalEvents pulls events for finished fixtures missing them, skipping ones already polled', async () => {
  // make every fixture look already-polled, then carve out one finished fixture with no events
  await db.update(fixture).set({ events: [] })
  await db.update(fixture).set({ status: 'final', events: null }).where(eq(fixture.id, '9002'))
  await db.update(fixture).set({ status: 'final', events: [] }).where(eq(fixture.id, '9001'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const n = await backfillFinalEvents(db, eventsProvider([goalRaw()]), xw)
  expect(n).toBe(1) // only 9002 qualified (final AND events null)
  const [f2] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(f2.events).toHaveLength(1) // backfilled silently
  const [f1] = await db.select().from(fixture).where(eq(fixture.id, '9001'))
  expect(f1.events).toEqual([]) // already polled → untouched
})

test('backfillFinalEvents ignores non-final fixtures and is a no-op when nothing qualifies', async () => {
  await db.update(fixture).set({ events: [] })
  await db.update(fixture).set({ status: 'live', events: null }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db, COMPETITION_ID)
  const n = await backfillFinalEvents(db, eventsProvider([goalRaw()]), xw)
  expect(n).toBe(0) // a live fixture with null events is left for the live poller, not backfilled
  const [f2] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(f2.events).toBeNull() // untouched
})

test('pollLive persists the 90-minute regulation score on a knockout final', async () => {
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'live', score1: 1, score2: 1, regScore1: null, regScore2: null }).where(eq(fixture.id, f.id))
  // stub provider: a knockout match decided in ET — final score 2:1, but 90' was 1:1
  const provider = { fetchFixturesByIds: async () => [{ id: f.id, status: 'final', score1: 2, score2: 1, minute: 120, htScore1: 0, htScore2: 1, regScore1: 1, regScore2: 1 }] }
  await pollLive(db, provider, [f.id])
  const [after] = await db.select().from(fixture).where(eq(fixture.id, f.id))
  expect([after.regScore1, after.regScore2]).toEqual([1, 1])
})
