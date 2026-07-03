import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor } from '../src/db/schema.js'
import { syncCompetitors, slugName } from '../src/worker/sync-competitors.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA = { id: 'apibasketball:12:2023-2024', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024' }

afterAll(async () => {
  await db.delete(competitor).where(eq(competitor.competitionId, NBA.id))
  await db.delete(competition).where(eq(competition.id, NBA.id))
  await pool.end()
})

test('slugName produces stable url/wire-safe codes', () => {
  expect(slugName('Oklahoma City Thunder')).toBe('oklahoma-city-thunder')
  expect(slugName('Portland Trail Blazers')).toBe('portland-trail-blazers')
})

test('syncCompetitors inserts the 30 franchises with conference meta, then deletes leavers', async () => {
  await db.insert(competition).values({ ...NBA, format: 'league', name: 'NBA' }).onConflictDoNothing()
  const provider = createRecordedBasketballProvider({ teams: load('teams'), standings: load('standings') })
  const r1 = await syncCompetitors(db, provider, NBA)
  expect(r1).toMatchObject({ inserted: 30, deleted: 0 })
  const rows = await db.select().from(competitor).where(eq(competitor.competitionId, NBA.id))
  expect(rows).toHaveLength(30)
  const okc = rows.find((c) => c.code === 'oklahoma-city-thunder')
  expect(okc.providerId).toBe(152)
  expect(okc.meta.conference).toBe('Western Conference')
  expect(okc.color).toMatch(/^hsl\(/)
  expect(okc.logo).toMatch(/^https:/)

  // second run: idempotent updates, no dupes
  const r2 = await syncCompetitors(db, provider, NBA)
  expect(r2).toMatchObject({ inserted: 0, updated: 30, deleted: 0 })

  // a team leaving the feed is deleted
  const teams31 = structuredClone(load('teams'))
  teams31.response = teams31.response.filter((t) => t.id !== 152)
  const r3 = await syncCompetitors(db, createRecordedBasketballProvider({ teams: teams31, standings: load('standings') }), NBA)
  expect(r3.deleted).toBe(1)
  expect(await db.select().from(competitor).where(eq(competitor.competitionId, NBA.id))).toHaveLength(29)
})
