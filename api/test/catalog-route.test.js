import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, catalogLeague } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_cat', email: 'cat@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'catsession', accountId: 'ac_cat', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(catalogLeague).values([
    { id: 'apifootball:3939', provider: 'apifootball', providerLeagueId: '3939', name: 'Premier League', type: 'League',
      country: { name: 'England', code: 'GB-ENG', flag: null }, curated: true,
      seasons: [
        { season: '2027', start: '2027-08-21', end: '2028-05-30', current: false, standings: false, odds: false }, // no standings → not provisionable
        { season: '2026', start: '2026-08-15', end: '2027-05-24', current: true, standings: true, odds: false },
        { season: '2024', start: '2024-08-16', end: '2025-05-25', current: false, standings: true, odds: false }, // over → nothing to sweep
      ] },
    { id: 'apibasketball:1212', provider: 'apibasketball', providerLeagueId: '1212', name: 'NBA', type: 'League',
      country: { name: 'USA', code: 'US', flag: null }, curated: true,
      seasons: [
        { season: '2025-2026', start: '2025-09-30', end: '2026-06-18', current: false, standings: true, odds: false }, // outside the free window
        { season: '2024-2025', start: '2024-10-05', end: '2099-06-18', current: false, standings: true, odds: false },
      ] },
    { id: 'apifootball:9999', provider: 'apifootball', providerLeagueId: '9999', name: 'Obscure NotCurated League', type: 'League',
      country: { name: 'England', code: null, flag: null }, curated: false,
      seasons: [{ season: '2025', start: '2025-01-01', end: '2025-12-31', current: false, standings: true, odds: false }] },
  ])
})
afterAll(async () => {
  await db.delete(catalogLeague).where(inArray(catalogLeague.id, ['apifootball:3939', 'apibasketball:1212', 'apifootball:9999']))
  await db.delete(accountSession).where(eq(accountSession.token, 'catsession'))
  await db.delete(account).where(eq(account.id, 'ac_cat'))
  await app.close(); await pool.end()
})

const M = { headers: { 'x-account-token': 'catsession' } }

test('catalog returns curated rows with only provisionable seasons', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/catalog', ...M })
  expect(res.statusCode).toBe(200)
  const rows = res.json()
  expect(rows.map((r) => r.name).sort()).toEqual(['NBA', 'Premier League']) // non-curated invisible
  const epl = rows.find((r) => r.name === 'Premier League')
  expect(epl).toMatchObject({ provider: 'apifootball', sport: 'football', leagueId: '3939' })
  expect(epl.seasons.map((s) => s.season)).toEqual(['2026']) // 2027 dropped: standings:false — 2024 dropped: already over
  const nba = rows.find((r) => r.name === 'NBA')
  expect(nba.seasons.map((s) => s.season)).toEqual(['2024-2025']) // 2025-2026 dropped: window
})

test('sport + q filters, auth required', async () => {
  const bySport = await app.inject({ method: 'GET', url: '/api/catalog?sport=basketball', ...M })
  expect(bySport.json().map((r) => r.name)).toEqual(['NBA'])
  const byQ = await app.inject({ method: 'GET', url: '/api/catalog?q=engl', ...M })
  expect(byQ.json().map((r) => r.name)).toEqual(['Premier League']) // matches country name
  expect((await app.inject({ method: 'GET', url: '/api/catalog' })).statusCode).toBe(401)
})
