import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { newToken } from '../src/sweeps/tokens.js'
import { sweep, person, ownership, watch, support } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const memberB = newToken()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })

async function sessionCookie(token) {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token } })
  return res.headers['set-cookie']
}

beforeAll(async () => {
  await app.ready()
  await db.insert(sweep).values({ id: 'sw_b', name: 'B', kind: 'token', memberToken: memberB, adminToken: newToken() })
  await db.insert(person).values({ id: 'pb1', sweepId: 'sw_b', name: 'Bee', short: 'Bee', initials: 'B', avColor: '#111' })
  await db.insert(ownership).values({ sweepId: 'sw_b', personId: 'pb1', teamCode: 'hr' })
})
afterAll(async () => {
  // Leave the shared test DB as we found it (seed.test.js counts persons globally).
  await db.delete(watch).where(eq(watch.sweepId, 'sw_b'))
  await db.delete(support).where(eq(support.sweepId, 'sw_b'))
  await db.delete(ownership).where(eq(ownership.sweepId, 'sw_b'))
  await db.delete(person).where(eq(person.sweepId, 'sw_b'))
  await db.delete(sweep).where(eq(sweep.id, 'sw_b'))
  await app.close(); await pool.end()
})

test('default-host bootstrap returns only the default sweep people', async () => {
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.people.every((p) => p.id !== 'pb1')).toBe(true)
  expect(body.people).toHaveLength(16)
})

test('sweep B (platform host + cookie) sees only its own person', async () => {
  const cookie = await sessionCookie(memberB)
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test', cookie } })).json()
  expect(body.people).toHaveLength(1)
  expect(body.people[0].id).toBe('pb1')
  expect(body.ownership.pb1).toEqual(['hr'])
})

test('platform host with no cookie is 401 on scoped data', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test' } })
  expect(res.statusCode).toBe(401)
})

test('a watch in sweep B is invisible to the default sweep', async () => {
  const cookie = await sessionCookie(memberB)
  await app.inject({ method: 'POST', url: '/api/watch', headers: { host: 'platform.test', cookie },
    payload: { fixtureId: 'm0', personId: 'pb1' } })
  // default host social must not contain pb1's watch
  const def = (await app.inject({ method: 'GET', url: '/api/social' })).json()
  const all = Object.values(def.watch).flat()
  expect(all).not.toContain('pb1')
  // sweep B social shows it
  const b = (await app.inject({ method: 'GET', url: '/api/social', headers: { host: 'platform.test', cookie } })).json()
  expect(b.watch.m0).toContain('pb1')
})
