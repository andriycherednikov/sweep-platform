import { expect, test, afterAll } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, team } from '../src/db/schema.js'

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
  for (const t of ['person', 'team', 'ownership', 'sweep', 'team_crosswalk']) {
    expect(names).toContain(t)
  }
  for (const t of ['fixture', 'standing', 'sync_log', 'watch', 'support', 'photo']) {
    expect(names).toContain(t)
  }
})
