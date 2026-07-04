import { test, expect, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event, ranking } from '../src/db/schema.js'
import { addCompetition } from '../src/worker/add-competition.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const ID = 'apibasketball:12:2023-2024'
const CATALOG_META_ID = 'apibasketball:12:catalog-meta'
const provider = () => createRecordedBasketballProvider({
  leagues: load('leagues'), teams: load('teams'), games: load('games'), standings: load('standings'),
})

beforeEach(async () => {
  // Clear data before each test to prevent collisions across tests
  for (const compId of [ID, CATALOG_META_ID]) {
    await db.delete(event).where(eq(event.competitionId, compId))
    await db.delete(ranking).where(eq(ranking.competitionId, compId))
    await db.delete(competitor).where(eq(competitor.competitionId, compId))
    await db.delete(competition).where(eq(competition.id, compId))
  }
})

afterAll(async () => {
  await db.delete(event).where(eq(event.competitionId, ID))
  await db.delete(ranking).where(eq(ranking.competitionId, ID))
  await db.delete(competitor).where(eq(competitor.competitionId, ID))
  await db.delete(competition).where(eq(competition.id, ID))
  await db.delete(event).where(eq(event.competitionId, 'apibasketball:12:catalog-meta'))
  await db.delete(ranking).where(eq(ranking.competitionId, 'apibasketball:12:catalog-meta'))
  await db.delete(competitor).where(eq(competitor.competitionId, 'apibasketball:12:catalog-meta'))
  await db.delete(competition).where(eq(competition.id, 'apibasketball:12:catalog-meta'))
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

test('addCompetition with league meta provided skips the live catalog lookup', async () => {
  const p = provider()
  let catalogCalls = 0
  const counting = { ...p, fetchCompetitions: async () => { catalogCalls++; return p.fetchCompetitions() } }
  const r = await addCompetition(db, counting, {
    provider: 'apibasketball', leagueId: '12', season: 'catalog-meta',
    league: { name: 'NBA', type: 'League', logo: 'https://x/logo.png' },
  })
  expect(catalogCalls).toBe(0) // the budget rule: no per-request catalog fetch
  expect(r.competitionId).toBe('apibasketball:12:catalog-meta')
  const [comp] = await db.select().from(competition).where(eq(competition.id, 'apibasketball:12:catalog-meta'))
  expect(comp).toMatchObject({ name: 'NBA', format: 'league', logo: 'https://x/logo.png' })
})
