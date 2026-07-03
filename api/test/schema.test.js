import { expect, test, afterAll } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event, ranking, sweep, account } from '../src/db/schema.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

test('event.detail round-trips a JSON object', async () => {
  const [before] = await db.select().from(event).where(eq(event.id, 'm0'))
  const detail = {
    ...before.detail,
    lineups: [{ teamCode: 'hr', formation: '4-3-3', startXI: [{ name: 'Luka', number: 10, pos: 'M' }] }],
    events: [{ id: '23|0|hr|Modric|goal|Penalty', type: 'goal', teamCode: 'hr', player: 'Modric', minute: 23, detail: 'Penalty', assist: null }],
  }
  await db.update(event).set({ detail }).where(eq(event.id, 'm0'))
  const [row] = await db.select().from(event).where(eq(event.id, 'm0'))
  expect(row.detail).toEqual(detail)
  await db.update(event).set({ detail: before.detail }).where(eq(event.id, 'm0')) // restore seed
})

test('competitor.meta round-trips a JSON array', async () => {
  const squad = [{ name: 'L. Modric', number: 10, pos: 'Midfielder', photo: 'https://x/10.png' }]
  const [existing] = await db.select().from(competitor).where(eq(competitor.code, 'hr'))
  await db.update(competitor).set({ meta: { ...existing.meta, squad } }).where(eq(competitor.id, existing.id))
  const [row] = await db.select().from(competitor).where(eq(competitor.id, existing.id))
  expect(row.meta.squad).toEqual(squad)
  await db.update(competitor).set({ meta: existing.meta }).where(eq(competitor.id, existing.id)) // restore seed
})

test('old soccer-shaped tables do not exist', async () => {
  const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema='public'`)
  const names = rows.rows.map((r) => r.table_name)
  for (const t of ['team', 'fixture', 'standing', 'team_crosswalk']) {
    expect(names).not.toContain(t)
  }
})

test('reference tables exist', async () => {
  const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema='public'`)
  const names = rows.rows.map((r) => r.table_name)
  for (const t of ['person', 'ownership', 'sweep',
    'account', 'competition', 'competitor', 'event', 'ranking']) {
    expect(names).toContain(t)
  }
})

test('seed created the default competition, bound the default sweep, and wired competitor ids', async () => {
  const [comp] = await db.select().from(competition)
  expect(comp.id).toBe('apifootball:1:2026')
  expect(comp.format).toBe('groups_then_ko')
  const [sw] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(sw.competitionId).toBe(comp.id)
  const [ev] = await db.select().from(event).where(eq(event.id, 'm0'))
  expect(ev.detail.group).toBeTruthy()
  const [cp] = await db.select().from(competitor).where(eq(competitor.code, ev.c1Code))
  expect(cp.id).toBe(`cp_${comp.id}_${ev.c1Code}`)
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
