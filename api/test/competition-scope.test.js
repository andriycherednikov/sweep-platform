// GATE(phase-2): members of a sweep must not be able to reference another
// competitions events by id. Covers the five bare event-id lookups:
// GET /api/fixtures/:id, POST /api/bet, parlay legs, POST /api/support, fan-photo upload.
import { expect, test, afterAll, beforeAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FormData from 'form-data'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { newToken } from '../src/sweeps/tokens.js'
import { competition, competitor, event, person, support, bet, parlay, coinLedger, photo, sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const OTHER = 'test:other:1'
let dir, app

async function sessionCookie(token) {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token } })
  return res.headers['set-cookie']
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-scope-'))
  app = buildApp(db, { photosDir: dir, sessionSecret: 'test-secret', platformHost: 'platform.test' })
  await app.ready()
  // a second competition with an upcoming, odds-bearing event - never visible to the default sweep
  await db.insert(competition).values({ id: OTHER, provider: 'test', sport: 'basketball', leagueId: 'other', season: '1', format: 'league', name: 'Other League' })
  await db.insert(competitor).values([
    { id: 'cpO_lal', competitionId: OTHER, code: 'lal', name: 'Lakers', color: '#552583' },
    { id: 'cpO_bos', competitionId: OTHER, code: 'bos', name: 'Celtics', color: '#007A33' },
  ])
  await db.insert(event).values({
    id: 'evO_1', competitionId: OTHER, c1Code: 'lal', c2Code: 'bos',
    startUtc: new Date('2027-01-01T00:00:00Z'), status: 'upcoming', stage: 'group',
    detail: { markets: {
      '1x2': { selections: [{ key: 'HOME', odds: 1.9 }, { key: 'AWAY', odds: 1.9 }] },
      ou25: { line: 2.5, selections: [{ key: 'OVER', odds: 1.9 }, { key: 'UNDER', odds: 1.9 }] },
    } },
  })
})

afterAll(async () => {
  // rows a leaking (pre-fix) run may have created reference evO_1 - clear them before the event
  await db.delete(support).where(eq(support.fixtureId, 'evO_1'))
  await db.delete(photo).where(eq(photo.fixtureId, 'evO_1'))
  await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger)
  await db.delete(event).where(eq(event.id, 'evO_1'))
  await db.delete(competitor).where(eq(competitor.competitionId, OTHER))
  await db.delete(competition).where(eq(competition.id, OTHER))
  await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true })
})

const aPerson = async () => (await db.select().from(person).where(eq(person.sweepId, 'default')).limit(1))[0]

test('GET /api/fixtures/:id 404s for another competitions event', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fixtures/evO_1' })
  expect(res.statusCode).toBe(404)
})

test('POST /api/support rejects another competitions event', async () => {
  const p = await aPerson()
  const res = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: 'evO_1', personId: p.id, teamCode: 'lal' } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('unknown_fixture')
})

test('POST /api/bet rejects another competitions event', async () => {
  const p = await aPerson()
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: 'evO_1', personId: p.id, selection: 'HOME', stake: 10 } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('unknown_fixture')
})

test('POST /api/parlay rejects a leg on another competitions event', async () => {
  const p = await aPerson()
  const res = await app.inject({ method: 'POST', url: '/api/parlay', payload: { personId: p.id, stake: 10, legs: [
    { fixtureId: 'evO_1', selection: 'HOME' },
    { fixtureId: 'evO_1', market: 'ou25', selection: 'OVER' },
  ] } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('fixture_not_found')
})

test('fan-photo upload rejects another competitions event', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer()
  const form = new FormData()
  form.append('kind', 'fan'); form.append('uploaderName', 'X'); form.append('fixtureId', 'evO_1')
  form.append('file', png, { filename: 'pic.png', contentType: 'image/png' })
  const res = await app.inject({ method: 'POST', url: '/api/photos', headers: form.getHeaders(), payload: form.getBuffer() })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('unknown_fixture')
})

test('POST /api/support rejects a DRAW pick for a no-draw sport', async () => {
  const memberToken = newToken()
  await db.insert(sweep).values({ id: 'sw_nba', name: 'NBA sweep', kind: 'token', memberToken, adminToken: newToken(), competitionId: OTHER }).onConflictDoNothing()
  await db.insert(person).values({ id: 'pn_nba', sweepId: 'sw_nba', name: 'Nia', short: 'Nia', initials: 'NI', avColor: '#123' }).onConflictDoNothing()
  try {
    const cookie = await sessionCookie(memberToken)
    const res = await app.inject({
      method: 'POST', url: '/api/support',
      headers: { host: 'platform.test', cookie },
      payload: { fixtureId: 'evO_1', personId: 'pn_nba', teamCode: 'DRAW' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_team')
    // a real team pick on the same sweep/event still works
    const ok = await app.inject({
      method: 'POST', url: '/api/support',
      headers: { host: 'platform.test', cookie },
      payload: { fixtureId: 'evO_1', personId: 'pn_nba', teamCode: 'lal' },
    })
    expect(ok.statusCode).toBe(200)
  } finally {
    await db.delete(support).where(eq(support.sweepId, 'sw_nba'))
    await db.delete(person).where(eq(person.sweepId, 'sw_nba'))
    await db.delete(sweep).where(eq(sweep.id, 'sw_nba'))
  }
})
