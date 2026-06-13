import { expect, test, afterAll } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { SWEEP_COOKIE, signSweepCookie, parseSweepCookie } from '../src/sweeps/auth.js'

test('sign then parse round-trips sweepId + role', async () => {
  const app = Fastify()
  await app.register(cookie, { secret: 'test-secret' })
  await app.ready()
  const signed = app.signCookie(signSweepCookie('abc123', 'admin'))
  const un = app.unsignCookie(signed)
  expect(un.valid).toBe(true)
  expect(parseSweepCookie(un.value)).toEqual({ sweepId: 'abc123', role: 'admin' })
  await app.close()
})

test('parseSweepCookie returns null for malformed value', () => {
  expect(parseSweepCookie('garbage')).toBeNull()
  expect(parseSweepCookie('id:badrole')).toBeNull()
})

import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { newToken } from '../src/sweeps/tokens.js'
import { sweep } from '../src/db/schema.js'

const { pool: pool2, db: db2 } = openTestDb()
const memberTok = newToken(), adminTok = newToken()
const app2 = buildApp(db2, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
afterAll(async () => { await app2.close(); await pool2.end() })

test('POST /api/session with a member token sets a member-scoped cookie', async () => {
  await app2.ready()
  await db2.insert(sweep).values({ id: 'sw_sess', name: 'S', kind: 'token', memberToken: memberTok, adminToken: adminTok })
  const res = await app2.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberTok },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ sweepId: 'sw_sess', role: 'member' })
  const cookie = res.headers['set-cookie']
  expect(cookie).toMatch(/sweep_session=/)
  const who = await app2.inject({ method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', cookie } })
  expect(who.json()).toEqual({ sweepId: 'sw_sess', role: 'member' })
})

test('admin token yields role admin; unknown token is 404', async () => {
  const ok = await app2.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: adminTok } })
  expect(ok.json()).toEqual({ sweepId: 'sw_sess', role: 'admin' })
  const bad = await app2.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: newToken() } })
  expect(bad.statusCode).toBe(404)
})
