import { test, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, catalogLeague, competition, competitor, event, ranking, sweep } from '../src/db/schema.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_ID = 'apibasketball:12:2023-2024'
const recordedB = () => createRecordedBasketballProvider({
  leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings'),
})
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  providerFor: (comp) => { if (comp.provider !== 'apibasketball') throw new Error(`unexpected provider ${comp.provider}`); return recordedB() },
})
const M = { headers: { 'x-account-token': 'swsession' } }

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_sw', email: 'sw@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'swsession', accountId: 'ac_sw', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(catalogLeague).values({
    id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
    country: { name: 'USA', code: 'US', flag: null }, curated: true,
    seasons: [{ season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false }],
  }).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_sw'))
  await db.delete(event).where(eq(event.competitionId, NBA_ID))
  await db.delete(ranking).where(eq(ranking.competitionId, NBA_ID))
  await db.delete(competitor).where(eq(competitor.competitionId, NBA_ID))
  await db.delete(competition).where(eq(competition.id, NBA_ID))
  await db.delete(catalogLeague).where(eq(catalogLeague.id, 'apibasketball:12'))
  await db.delete(accountSession).where(eq(accountSession.token, 'swsession'))
  await db.delete(account).where(eq(account.id, 'ac_sw'))
  await app.close(); await pool.end()
})

const provision = (name, over = {}) => app.inject({
  method: 'POST', url: '/api/account/sweeps', ...M,
  payload: { name, provider: 'apibasketball', leagueId: '12', season: '2023-2024', ...over },
})

test('provision creates competition once, reuses it after, owns the sweeps', async () => {
  const r1 = await provision('First')
  expect(r1.statusCode).toBe(201)
  const b1 = r1.json()
  expect(b1.competitionId).toBe(NBA_ID)
  expect(b1.memberLink).toContain(`/g/${b1.memberToken}`)
  expect((await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length).toBeGreaterThan(0)

  const evCount = (await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length
  const r2 = await provision('Second')
  expect(r2.statusCode).toBe(201)
  expect(r2.json().competitionId).toBe(NBA_ID) // same competition, deduped
  expect((await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length).toBe(evCount)

  const list = await app.inject({ method: 'GET', url: '/api/account/sweeps', ...M })
  expect(list.json().map((s) => s.name).sort()).toEqual(['First', 'Second'])
})

test('cap blocks the 4th sweep; archive frees the slot; ownership scoped', async () => {
  expect((await provision('Third')).statusCode).toBe(201)
  const fourth = await provision('Fourth')
  expect(fourth.statusCode).toBe(403)
  expect(fourth.json()).toMatchObject({ error: 'sweep_cap', cap: 3 })

  const mine = (await app.inject({ method: 'GET', url: '/api/account/sweeps', ...M })).json()
  const target = mine.find((s) => s.name === 'Third')
  const arch = await app.inject({ method: 'POST', url: `/api/account/sweeps/${target.id}/archive`, ...M })
  expect(arch.json()).toEqual({ id: target.id, archived: true })
  expect((await provision('Fourth')).statusCode).toBe(201)

  // someone else's sweep id → 404 (the seeded default sweep is unowned)
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps/default/archive', ...M })).statusCode).toBe(404)
})

test('validation: non-curated league, bad season, unauthenticated', async () => {
  await db.update(catalogLeague).set({ curated: false }).where(eq(catalogLeague.id, 'apibasketball:12'))
  expect((await provision('Nope')).statusCode).toBe(400)
  await db.update(catalogLeague).set({ curated: true }).where(eq(catalogLeague.id, 'apibasketball:12'))
  expect((await provision('Nope', { season: '2025-2026' })).statusCode).toBe(400) // outside free window
  expect((await provision('Nope', { leagueId: '422' })).statusCode).toBe(400)     // not in catalog
  const anon = await app.inject({ method: 'POST', url: '/api/account/sweeps', payload: { name: 'X', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(anon.statusCode).toBe(401)
})
