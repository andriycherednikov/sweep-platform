// api/test/selfserve-e2e.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, loginToken, catalogLeague, competition, competitor, event, ranking, sweep } from '../src/db/schema.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'

const { pool, db } = openTestDb()
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_ID = 'apibasketball:12:2023-2024'
const EPL_ID = 'apifootball:39:2025'

// tiny league-shaped football feed: 2 teams, 1 final + 1 upcoming, ranked standings
const eplFixture = (id, date, status, homeWin) => ({
  fixture: { id, date, status: { short: status, elapsed: status === 'FT' ? 90 : null }, venue: { name: 'V', city: 'C' } },
  league: { round: 'Regular Season - 21' },
  teams: { home: { id: 42, winner: status === 'FT' ? homeWin : null }, away: { id: 40, winner: status === 'FT' ? !homeWin : null } },
  goals: status === 'FT' ? { home: 2, away: 1 } : { home: null, away: null },
  score: { halftime: { home: null, away: null }, fulltime: { home: null, away: null }, penalty: { home: null, away: null } },
})
const eplProvider = () => createRecordedProvider({
  teams: { response: [
    { team: { id: 42, name: 'Arsenal', code: 'ARS', country: 'England' } },
    { team: { id: 40, name: 'Liverpool', code: 'LIV', country: 'England' } },
  ] },
  fixtures: { response: [eplFixture(7720001, '2026-01-10T15:00:00+00:00', 'FT', true), eplFixture(7720002, '2026-07-20T15:00:00+00:00', 'NS', null)] },
  standings: { response: [{ league: { standings: [[
    { team: { id: 40, name: 'Liverpool' }, group: 'Premier League', rank: 1, points: 50, all: { played: 21, win: 16, draw: 2, lose: 3, goals: { for: 55, against: 20 } } },
    { team: { id: 42, name: 'Arsenal' }, group: 'Premier League', rank: 2, points: 47, all: { played: 21, win: 14, draw: 5, lose: 2, goals: { for: 44, against: 18 } } },
  ]] } }] },
  predictions: { response: [] },
})
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  sendMail: async (to, subject, body) => mails.push(body),
  providerFor: (c) => (c.provider === 'apibasketball'
    ? createRecordedBasketballProvider({ leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings') })
    : eplProvider()),
})
const mails = []

beforeAll(async () => {
  await app.ready()
  await db.insert(catalogLeague).values([
    { id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
      country: { name: 'USA', code: 'US', flag: null }, curated: true,
      seasons: [{ season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false }] },
    { id: 'apifootball:39', provider: 'apifootball', providerLeagueId: '39', name: 'Premier League', type: 'League',
      country: { name: 'England', code: 'GB-ENG', flag: null }, curated: true,
      seasons: [{ season: '2025', start: '2025-08-15', end: '2026-05-24', current: false, standings: true, odds: false }] },
  ]).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(sweep).where(inArray(sweep.competitionId, [NBA_ID, EPL_ID]))
  for (const id of [NBA_ID, EPL_ID]) {
    await db.delete(event).where(eq(event.competitionId, id))
    await db.delete(ranking).where(eq(ranking.competitionId, id))
    await db.delete(competitor).where(eq(competitor.competitionId, id))
    await db.delete(competition).where(eq(competition.id, id))
  }
  await db.delete(catalogLeague).where(inArray(catalogLeague.id, ['apibasketball:12', 'apifootball:39']))
  await db.delete(accountSession)
  await db.delete(loginToken)
  await db.delete(account).where(eq(account.email, 'e2e@x.test'))
  await app.close(); await pool.end()
})

test('§5 flow: sign in → browse → provision both sports → member link works → cap → archive', async () => {
  // 1. magic-link sign-in
  await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'e2e@x.test' } })
  const token = mails[0].match(/\/account\/login\/([0-9A-Za-z]+)/)[1]
  const { accountToken } = (await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })).json()
  const M = { headers: { 'x-account-token': accountToken } }

  // 2. browse the cached catalog — both sports visible, no provider call involved
  const cat = (await app.inject({ method: 'GET', url: '/api/catalog', ...M })).json()
  expect(cat.map((r) => r.name).sort()).toEqual(['NBA', 'Premier League'])

  // 3. provision one sweep per sport
  const nba = (await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Hoops', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).json()
  const epl = (await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Footy', provider: 'apifootball', leagueId: '39', season: '2025' } })).json()
  expect(nba.competitionId).toBe(NBA_ID)
  expect(epl.competitionId).toBe(EPL_ID)

  // 4. the member link works: fixtures served through the frozen wire, scoped per sweep
  const fixtures = await app.inject({ method: 'GET', url: '/api/fixtures',
    headers: { host: 'platform.test', cookie: await memberCookie(nba.memberToken) } })
  expect(fixtures.statusCode).toBe(200)
  expect(fixtures.json().length).toBeGreaterThan(0)
  expect(fixtures.json()[0]).toHaveProperty('t1') // wire field name (see nba-e2e.test.js:72)

  const eplFixtures = await app.inject({ method: 'GET', url: '/api/fixtures',
    headers: { host: 'platform.test', cookie: await memberCookie(epl.memberToken) } })
  expect(eplFixtures.json()).toHaveLength(2)
  expect(eplFixtures.json().every((f) => f.stage === 'group')).toBe(true) // league rounds mapped

  // 5. cap blocks the 4th; archive frees it
  const third = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Third', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(third.statusCode).toBe(201)
  const fourth = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Fourth', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(fourth.statusCode).toBe(403)
  await app.inject({ method: 'POST', url: `/api/account/sweeps/${third.json().id}/archive`, ...M })
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Fourth', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).statusCode).toBe(201)
})

async function memberCookie(memberToken) {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberToken } })
  return res.headers['set-cookie']
}
