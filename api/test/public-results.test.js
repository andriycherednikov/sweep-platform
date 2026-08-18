import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { eq } from 'drizzle-orm'
import { competition, competitor, event } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
const COMP = 'apibasketball:public-results:1'
// the suite shares one database — leave it exactly as found
afterAll(async () => {
  await db.delete(event).where(eq(event.competitionId, COMP))
  await db.delete(competitor).where(eq(competitor.competitionId, COMP))
  await db.delete(competition).where(eq(competition.id, COMP))
  await app.close(); await pool.end()
})

/* The marketing page has no session and no sweep, so it needs a source of its own.
   Results are public sports facts — no sweep, person or account data goes out. */
test('GET /api/public/results returns finished games, newest first, with the winner named', async () => {
  // dated past the suite's seeded World Cup so these two are genuinely the latest
  await db.insert(competition).values({
    id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: 'public-results',
    season: '1', format: 'league', name: 'Test League',
  })
  await db.insert(competitor).values([
    { id: 'cpPR_bos', competitionId: COMP, code: 'bos', name: 'Celtics', color: '#007A33' },
    { id: 'cpPR_dal', competitionId: COMP, code: 'dal', name: 'Mavericks', color: '#00538C' },
    { id: 'cpPR_mia', competitionId: COMP, code: 'mia', name: 'Heat', color: '#98002E' },
  ])
  await db.insert(event).values([
    { id: 'evPR_old', competitionId: COMP, c1Code: 'bos', c2Code: 'dal', startUtc: new Date('2027-01-01T00:00:00Z'), status: 'final', score1: 101, score2: 99, winnerCode: 'bos' },
    { id: 'evPR_new', competitionId: COMP, c1Code: 'mia', c2Code: 'bos', startUtc: new Date('2027-02-01T00:00:00Z'), status: 'final', score1: 88, score2: 104, winnerCode: 'bos' },
    { id: 'evPR_soon', competitionId: COMP, c1Code: 'dal', c2Code: 'mia', startUtc: new Date('2099-01-01T00:00:00Z'), status: 'upcoming' },
  ])

  const res = await app.inject({ method: 'GET', url: '/api/public/results' })
  expect(res.statusCode).toBe(200)
  const rows = res.json()

  const ids = rows.map((r) => r.id)
  expect(ids).toContain('evPR_new')
  expect(ids).toContain('evPR_old')
  expect(ids).not.toContain('evPR_soon')          // unplayed games have nothing to report
  expect(ids.indexOf('evPR_new')).toBeLessThan(ids.indexOf('evPR_old'))

  const latest = rows.find((r) => r.id === 'evPR_new')
  expect(latest).toMatchObject({
    competition: 'Test League', sport: 'basketball',
    home: { name: 'Heat', score: 88, won: false },
    away: { name: 'Celtics', score: 104, won: true },
  })
  // nothing about the sweep, its people or the account may ride along
  expect(JSON.stringify(rows)).not.toMatch(/sweep|person|account|token/i)
})

test('GET /api/public/results caps the list', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/public/results' })
  expect(res.json().length).toBeLessThanOrEqual(20)
})
