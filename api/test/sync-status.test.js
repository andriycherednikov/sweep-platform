import { expect, test, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { eq, inArray } from 'drizzle-orm'
import { syncLog, competition, sweep } from '../src/db/schema.js'
import { newToken } from '../src/sweeps/tokens.js'
import { DEFAULT_SWEEP_ID } from '../src/sweeps/constants.js'

// A request with no platform Host resolves to the seeded default sweep, so rows must
// carry ITS competition to answer for it — that is the whole point of the scoping.
const defaultCompetitionId = async () =>
  (await db.select().from(sweep).where(eq(sweep.id, DEFAULT_SWEEP_ID)))[0].competitionId

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })
beforeEach(async () => { await db.delete(syncLog) })

test('stale=true when no baseline sync has ever run', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/sync-status' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ stale: true, lastBaselineAt: null })
})

test('stale=false right after a successful baseline sync', async () => {
  await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'ok', competitionId: await defaultCompetitionId() })
  expect((await app.inject({ method: 'GET', url: '/api/sync-status' })).json().stale).toBe(false)
})

test('stale=true when newest OK baseline is older than 18h', async () => {
  const old = new Date(Date.now() - 19 * 3600_000)
  await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'ok', ranAt: old, competitionId: await defaultCompetitionId() })
  expect((await app.inject({ method: 'GET', url: '/api/sync-status' })).json().stale).toBe(true)
})

// One healthy competition used to make every other sweep report "fresh": sync_log had
// no competition_id, so the newest row anywhere answered for everyone. And the query
// filtered to status='ok', so a competition whose feed was failing had no way to say so
// — the two faults together meant the product's only health signal was blind in both
// directions.
async function sweepOn(competitionId, name) {
  const memberToken = newToken()
  await db.insert(competition).values({
    id: competitionId, provider: 'apifootball', sport: 'football',
    leagueId: name, season: '1', format: 'league', name,
  })
  await db.insert(sweep).values({
    id: `sw_${name}`, name, kind: 'token', memberToken, adminToken: newToken(), competitionId,
  })
  const login = await app.inject({ method: 'POST', url: '/api/session', headers: { host: app.platformHost }, payload: { token: memberToken } })
  const cookie = login.headers['set-cookie']
  return () => app.inject({ method: 'GET', url: '/api/sync-status', headers: { host: app.platformHost, cookie } })
}

test("one competition's healthy sync does not vouch for another's", async () => {
  const A = 'apifootball:syncA:1', B = 'apifootball:syncB:1'
  const askA = await sweepOn(A, 'syncA')
  const askB = await sweepOn(B, 'syncB')
  try {
    await db.insert(syncLog).values({ source: 'apifootball', kind: 'baseline', status: 'ok', competitionId: A })
    expect((await askA()).json().stale).toBe(false)
    expect((await askB()).json().stale).toBe(true) // B has never synced; A's success is not B's
  } finally {
    await db.delete(sweep).where(inArray(sweep.id, ['sw_syncA', 'sw_syncB']))
    await db.delete(syncLog)
    await db.delete(competition).where(inArray(competition.id, [A, B]))
  }
})

test('a failing feed is visible instead of silent', async () => {
  const C = 'apifootball:syncC:1'
  const ask = await sweepOn(C, 'syncC')
  try {
    await db.insert(syncLog).values({ source: 'apifootball', kind: 'baseline', status: 'ok', competitionId: C })
    expect((await ask()).json().lastError).toBeNull()

    await db.insert(syncLog).values({
      source: 'apifootball', kind: 'live', status: 'error', competitionId: C,
      error: 'api-sports /fixtures → plan: Free plans do not have access to this season',
    })
    const body = (await ask()).json()
    expect(body.lastError).toMatchObject({ kind: 'live' })
    expect(body.lastError.error).toMatch(/Free plans do not have access/)
    expect(body.lastError.at).toBeTruthy()
    expect(body.stale).toBe(false) // the baseline is still fresh; the error is reported, not conflated
  } finally {
    await db.delete(sweep).where(eq(sweep.id, 'sw_syncC'))
    await db.delete(syncLog)
    await db.delete(competition).where(eq(competition.id, C))
  }
})
