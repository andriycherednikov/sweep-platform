import { test, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition } from '../src/db/schema.js'
import { earliestFootballCompetition } from '../src/worker/cutover.js'

const { pool, db } = openTestDb()
const NBA_ID = 'apibasketball:12:cutover-test'

afterAll(async () => {
  await db.delete(competition).where(eq(competition.id, NBA_ID))
  await pool.end()
})

test('cutover targets the earliest FOOTBALL competition, never an older basketball one', async () => {
  // a basketball competition older than everything else — the old "earliest wins" query would pick it
  await db.insert(competition).values({
    id: NBA_ID, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'cutover-test',
    format: 'league', name: 'NBA', createdAt: new Date('2000-01-01'),
  }).onConflictDoNothing()
  const comp = await earliestFootballCompetition(db)
  expect(comp.sport).toBe('football')
  expect(comp.id).toBe('apifootball:1:2026') // the seeded WC comp, not the older NBA row
})
