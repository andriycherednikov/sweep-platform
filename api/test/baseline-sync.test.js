import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk, fixture, standing, syncLog } from '../src/db/schema.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()

const provider = createRecordedProvider({
  fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams'),
})

beforeAll(async () => {
  // wire crosswalk: hr→3001, be→3002, gh→3003 (matches recorded JSON)
  await db.update(teamCrosswalk).set({ providerTeamId: 3001 }).where(eq(teamCrosswalk.teamCode, 'hr'))
  await db.update(teamCrosswalk).set({ providerTeamId: 3002 }).where(eq(teamCrosswalk.teamCode, 'be'))
  await db.update(teamCrosswalk).set({ providerTeamId: 3003 }).where(eq(teamCrosswalk.teamCode, 'gh'))
})
afterAll(async () => { await pool.end() })

test('baseline sync upserts provider fixtures, prunes seed fixtures, logs ok', async () => {
  await syncBaseline(db, provider, { season: 2026 })
  const fx = await db.select().from(fixture)
  const ids = fx.map((f) => f.id).sort()
  expect(ids).toEqual(['9001', '9002'])            // seeded m0..m71 pruned; provider fixtures present
  const f1 = fx.find((f) => f.id === '9001')
  expect(f1).toMatchObject({ t1Code: 'hr', t2Code: 'be', status: 'final', score1: 2, score2: 1, group: 'L', matchday: 1 })
  expect(f1.probA).toBe(55)                        // predictions applied
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('ok')
})

test('is idempotent — second run changes nothing structural', async () => {
  await syncBaseline(db, provider, { season: 2026 })
  expect((await db.select().from(fixture)).length).toBe(2)
  const cro = (await db.select().from(standing).where(eq(standing.teamCode, 'hr')))[0]
  expect(cro).toMatchObject({ played: 1, win: 1, pts: 3, gf: 2, ga: 1 })
})

test('a provider failure leaves last-good data and logs an error row', async () => {
  const boom = { ...provider, async fetchFixtures() { throw new Error('upstream 503') } }
  await expect(syncBaseline(db, boom, { season: 2026 })).rejects.toThrow(/503/)
  expect((await db.select().from(fixture)).length).toBe(2) // unchanged
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('error')
  expect(logs.at(-1).error).toMatch(/503/)
})
