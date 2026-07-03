import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { seed } from '../src/seed/seed.js'
import { competitor, person, event, ownership } from '../src/db/schema.js'

const { pool, db } = openTestDb()
beforeAll(async () => { await seed(db); await seed(db) }) // run twice → idempotent
afterAll(async () => { await pool.end() })

test('seeds 48 teams, 16 people, full fixture set', async () => {
  expect((await db.select().from(competitor)).length).toBe(48)
  expect((await db.select().from(person)).length).toBe(16)
  expect((await db.select().from(event)).length).toBe(72)
})

test('ownership links Andriy to Croatia', async () => {
  const rows = await db.select().from(ownership).where(eq(ownership.personId, 'p4'))
  expect(rows.map((r) => r.competitorId)).toContain('cp_apifootball:1:2026_hr')
})
