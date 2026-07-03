import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event, ranking } from '../src/db/schema.js'
import { addCompetition } from '../src/worker/add-competition.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const ID = 'apibasketball:12:2023-2024'
const provider = () => createRecordedBasketballProvider({
  leagues: load('leagues'), teams: load('teams'), games: load('games'), standings: load('standings'),
})

afterAll(async () => {
  await db.delete(event).where(eq(event.competitionId, ID))
  await db.delete(ranking).where(eq(ranking.competitionId, ID))
  await db.delete(competitor).where(eq(competitor.competitionId, ID))
  await db.delete(competition).where(eq(competition.id, ID))
  await pool.end()
})

test('addCompetition provisions competition + competitors + events + rankings in one shot', async () => {
  const r = await addCompetition(db, provider(), { provider: 'apibasketball', leagueId: '12', season: '2023-2024' })
  expect(r).toMatchObject({ competitionId: ID, competitors: 30, fixtures: 5 })
  const [comp] = await db.select().from(competition).where(eq(competition.id, ID))
  expect(comp).toMatchObject({ provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024', format: 'league', name: 'NBA' })
  expect(comp.logo).toMatch(/^https:/)
  await expect(addCompetition(db, provider(), { provider: 'apibasketball', leagueId: '12', season: '2023-2024' }))
    .rejects.toThrow(/already exists/)
})

test('addCompetition rejects a league missing from the catalog', async () => {
  await expect(addCompetition(db, provider(), { provider: 'apibasketball', leagueId: '999', season: '2023-2024' }))
    .rejects.toThrow(/not found/)
})
