import { expect, test, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
afterAll(async () => { await app.close(); await pool.end() })

test('sweep.wageringEnabled defaults false; seeded default sweep is true', async () => {
  const [dflt] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(dflt.wageringEnabled).toBe(true) // WC default behavior unchanged
  await db.insert(sweep).values({ id: 'sw_wgtest', name: 'W', kind: 'token', memberToken: 'mt_wgtest', adminToken: 'at_wgtest', competitionId: dflt.competitionId })
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'sw_wgtest'))
  expect(row.wageringEnabled).toBe(false) // new sweeps OFF unless opted in
  await db.delete(sweep).where(eq(sweep.id, 'sw_wgtest'))
})
