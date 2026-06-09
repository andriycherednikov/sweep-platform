import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { seed } from '../src/seed/seed.js'
import { team, person, fixture, ownership } from '../src/db/schema.js'

const { pool, db } = openTestDb()
beforeAll(async () => { await seed(db); await seed(db) }) // run twice → idempotent
afterAll(async () => { await pool.end() })

test('seeds 48 teams, 16 people, full fixture set', async () => {
  expect((await db.select().from(team)).length).toBe(48)
  expect((await db.select().from(person)).length).toBe(16)
  expect((await db.select().from(fixture)).length).toBe(72)
})

test('ownership links Andriy to Croatia', async () => {
  const rows = await db.select().from(ownership).where(eq(ownership.personId, 'p4'))
  expect(rows.map((r) => r.teamCode)).toContain('hr')
})
