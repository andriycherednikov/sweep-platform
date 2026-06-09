import { expect, test, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

test('reference tables exist', async () => {
  const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema='public'`)
  const names = rows.rows.map((r) => r.table_name)
  for (const t of ['person', 'team', 'ownership', 'scoring_config', 'team_crosswalk']) {
    expect(names).toContain(t)
  }
  for (const t of ['fixture', 'standing', 'sync_log', 'watch', 'support', 'photo']) {
    expect(names).toContain(t)
  }
})
