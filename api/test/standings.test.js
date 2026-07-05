import { expect, test, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, ranking, sweep } from '../src/db/schema.js'
import { newToken } from '../src/sweeps/tokens.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/standings groups teams A–L, sorted by points', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/standings' })
  expect(res.statusCode).toBe(200)
  const tables = res.json()
  expect(Object.keys(tables).sort()).toEqual('ABCDEFGHIJKL'.split(''))
  for (const g of Object.keys(tables)) {
    expect(tables[g]).toHaveLength(4)
    const pts = tables[g].map((t) => t.pts)
    expect(pts).toEqual([...pts].sort((a, b) => b - a))
  }
})

test('GET /api/standings groups by conference (meta.group fallback) and sorts by pct', async () => {
  const NBA = 'apibasketball:standings-test:1'
  const memberToken = newToken()
  await db.insert(competition).values({ id: NBA, provider: 'apibasketball', sport: 'basketball', leagueId: 'standings-test', season: '1', format: 'league', name: 'Test League' })
  await db.insert(competitor).values([
    { id: 'cpST_bos', competitionId: NBA, code: 'bos', name: 'Celtics', color: '#007A33', meta: { conference: 'Eastern Conference' } },
    { id: 'cpST_mia', competitionId: NBA, code: 'mia', name: 'Heat', color: '#98002E', meta: { conference: 'Eastern Conference' } },
  ])
  await db.insert(ranking).values([
    { competitionId: NBA, competitorCode: 'bos', points: 0, stats: { played: 2, win: 2, loss: 0, pf: 240, pa: 200, pct: 1.0 } },
    { competitionId: NBA, competitorCode: 'mia', points: 0, stats: { played: 2, win: 0, loss: 2, pf: 200, pa: 240, pct: 0 } },
  ])
  await db.insert(sweep).values({ id: 'sw_standings_test', name: 'Standings Test', kind: 'token', memberToken, adminToken: newToken(), competitionId: NBA })

  try {
    const login = await app.inject({ method: 'POST', url: '/api/session', headers: { host: app.platformHost }, payload: { token: memberToken } })
    const cookie = login.headers['set-cookie']
    const res = await app.inject({ method: 'GET', url: '/api/standings', headers: { host: app.platformHost, cookie } })
    expect(res.statusCode).toBe(200)
    const tables = res.json()
    expect(Object.keys(tables)).toContain('Eastern Conference')
    const rows = tables['Eastern Conference']
    expect(rows[0]).toMatchObject({ pct: 1, pf: 240, pa: 200 }) // pct sorts first despite pts=0
    expect(rows[0].win).toBe(2)
  } finally {
    await db.delete(sweep).where(eq(sweep.id, 'sw_standings_test'))
    await db.delete(ranking).where(eq(ranking.competitionId, NBA))
    await db.delete(competitor).where(eq(competitor.competitionId, NBA))
    await db.delete(competition).where(eq(competition.id, NBA))
  }
})
