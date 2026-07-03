import { expect, test, afterAll } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, team, competition, competitor, event, ranking, sweep, account } from '../src/db/schema.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

test('fixture.lineups round-trips a JSON array', async () => {
  const data = [{ teamCode: 'hr', formation: '4-3-3', startXI: [{ name: 'Luka', number: 10, pos: 'M' }] }]
  await db.update(fixture).set({ lineups: data }).where(eq(fixture.id, 'm0'))
  const row = (await db.select().from(fixture).where(eq(fixture.id, 'm0')))[0]
  expect(row.lineups).toEqual(data)
  await db.update(fixture).set({ lineups: null }).where(eq(fixture.id, 'm0')) // restore seed
})

test('fixture.events round-trips a JSON array and defaults to null', async () => {
  const data = [{ id: '23|0|hr|Modric|goal|Penalty', type: 'goal', teamCode: 'hr', player: 'Modric', minute: 23, detail: 'Penalty', assist: null }]
  await db.update(fixture).set({ events: data }).where(eq(fixture.id, 'm0'))
  const [row] = await db.select().from(fixture).where(eq(fixture.id, 'm0'))
  expect(row.events).toEqual(data)
  await db.update(fixture).set({ events: null }).where(eq(fixture.id, 'm0')) // restore seed
  const [restored] = await db.select().from(fixture).where(eq(fixture.id, 'm0'))
  expect(restored.events).toBeNull()
})

test('team.squad round-trips a JSON array', async () => {
  const squad = [{ name: 'L. Modric', number: 10, pos: 'Midfielder', photo: 'https://x/10.png' }]
  await db.update(team).set({ squad }).where(eq(team.code, 'hr'))
  const row = (await db.select().from(team).where(eq(team.code, 'hr')))[0]
  expect(row.squad).toEqual(squad)
  await db.update(team).set({ squad: null }).where(eq(team.code, 'hr')) // restore seed
})

test('reference tables exist', async () => {
  const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema='public'`)
  const names = rows.rows.map((r) => r.table_name)
  for (const t of ['person', 'team', 'ownership', 'sweep', 'team_crosswalk',
    'account', 'competition', 'competitor', 'event', 'ranking']) {
    expect(names).toContain(t)
  }
})

test('seed created the default competition, bound the default sweep, and mirrored ids', async () => {
  const [comp] = await db.select().from(competition)
  expect(comp.id).toBe('apifootball:1:2026')
  expect(comp.format).toBe('groups_then_ko')
  const [sw] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(sw.competitionId).toBe(comp.id)
  const [ev] = await db.select().from(event).where(eq(event.id, 'm0'))
  const [fx] = await db.select().from(fixture).where(eq(fixture.id, 'm0'))
  expect(ev.c1Code).toBe(fx.t1Code)
  expect(ev.detail.group).toBe(fx.group)
  const [cp] = await db.select().from(competitor).where(eq(competitor.code, fx.t1Code))
  expect(cp.id).toBe(`cp_${comp.id}_${fx.t1Code}`)
})

test('competitor id is namespaced by competition: same code under a second competition does not collide', async () => {
  const otherCompetitionId = 'apifootball:2:2026'
  await db.insert(competition).values({
    id: otherCompetitionId, provider: 'apifootball', sport: 'football', leagueId: '2',
    season: '2026', format: 'groups_then_ko', name: 'Other Competition',
  })
  const [existing] = await db.select().from(competitor).limit(1)
  const otherId = `cp_${otherCompetitionId}_${existing.code}`
  await db.insert(competitor).values({
    id: otherId, competitionId: otherCompetitionId, code: existing.code, name: existing.name, color: existing.color,
  })
  const rows = await db.select().from(competitor).where(eq(competitor.code, existing.code))
  const ids = rows.map((r) => r.id)
  expect(ids).toContain(existing.id)
  expect(ids).toContain(otherId)
  expect(existing.id).not.toBe(otherId)

  await db.delete(competitor).where(eq(competitor.id, otherId))
  await db.delete(competition).where(eq(competition.id, otherCompetitionId))
})
