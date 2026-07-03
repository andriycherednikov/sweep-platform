import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { and, eq, sql } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competitor, syncLog } from '../src/db/schema.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { syncSquads } from '../src/worker/sync-squads.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()
const COMPETITION_ID = 'apifootball:1:2026'
const hrRow = () => db.select().from(competitor).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'hr'))).then((r) => r[0])

beforeAll(async () => {
  await db.update(competitor).set({ providerId: 3001 }).where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'hr')))
})
afterAll(async () => {
  await db.update(competitor).set({ meta: sql`${competitor.meta} - 'squad'` })
    .where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'hr'))) // restore seed
  await pool.end()
})

test('syncSquads stores each crosswalked team\'s squad and logs ok', async () => {
  const provider = createRecordedProvider({ squads: load('squads') })
  const n = await syncSquads(db, provider)
  expect(n).toBeGreaterThanOrEqual(1)
  const hr = await hrRow()
  expect(hr.meta.squad).toHaveLength(5)
  expect(hr.meta.squad[0]).toMatchObject({ name: 'D. Livakovic', number: 1, pos: 'Goalkeeper' })
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'squads'))
  expect(logs.at(-1).status).toBe('ok')
})

test('syncSquads is best-effort: a failed fetch leaves prior squad intact', async () => {
  const prior = [{ name: 'Keep', number: 7, pos: 'Midfielder', photo: null }]
  await db.update(competitor).set({ meta: sql`${competitor.meta} || ${JSON.stringify({ squad: prior })}::jsonb` })
    .where(and(eq(competitor.competitionId, COMPETITION_ID), eq(competitor.code, 'hr')))
  const boom = { async fetchSquad() { throw new Error('squads 503') } }
  await expect(syncSquads(db, boom)).resolves.toBeTypeOf('number')
  const hr = await hrRow()
  expect(hr.meta.squad).toEqual(prior) // untouched
})
