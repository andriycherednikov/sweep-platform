import { expect, test, afterAll } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { SWEEP_COOKIE, signSweepCookie, parseSweepCookie, withSweep } from '../src/sweeps/auth.js'

test('sign then parse round-trips sweepId + role', async () => {
  const app = Fastify()
  await app.register(cookie, { secret: 'test-secret' })
  await app.ready()
  const signed = app.signCookie(signSweepCookie([{ sweepId: 'abc123', role: 'admin' }]))
  const un = app.unsignCookie(signed)
  expect(un.valid).toBe(true)
  expect(parseSweepCookie(un.value)).toEqual([{ sweepId: 'abc123', role: 'admin' }])
  await app.close()
})

test('parseSweepCookie returns null for malformed value', () => {
  expect(parseSweepCookie('garbage')).toBeNull()
  expect(parseSweepCookie('id:badrole')).toBeNull()
})

// One cookie per browser meant a second sweep silently signed you out of the first,
// so two tabs could never hold two sweeps. The value is a list now; a cookie minted
// before this change is a valid one-element list, so live sessions survive the deploy.
test('a legacy single-entry cookie parses as a one-element list', () => {
  expect(parseSweepCookie('abc123:admin')).toEqual([{ sweepId: 'abc123', role: 'admin' }])
})

test('a list round-trips in order, most-recent first', () => {
  const list = [{ sweepId: 'sw_b', role: 'admin' }, { sweepId: 'sw_a', role: 'member' }]
  expect(parseSweepCookie(signSweepCookie(list))).toEqual(list)
})

test('a malformed entry is dropped, not fatal; an all-malformed value is null', () => {
  expect(parseSweepCookie('sw_a:member,junk,sw_b:admin'))
    .toEqual([{ sweepId: 'sw_a', role: 'member' }, { sweepId: 'sw_b', role: 'admin' }])
  expect(parseSweepCookie('junk,also:badrole')).toBeNull()
})

test('withSweep moves a sweep to the front, upserts its role, and caps the list', () => {
  const a = withSweep(null, 'sw_a', 'member')
  expect(a).toEqual([{ sweepId: 'sw_a', role: 'member' }])
  const b = withSweep(a, 'sw_b', 'admin')
  expect(b).toEqual([{ sweepId: 'sw_b', role: 'admin' }, { sweepId: 'sw_a', role: 'member' }])
  // re-opening sw_a as admin promotes it AND upgrades the role, without duplicating
  expect(withSweep(b, 'sw_a', 'admin'))
    .toEqual([{ sweepId: 'sw_a', role: 'admin' }, { sweepId: 'sw_b', role: 'admin' }])
  // ponytail: cap 8 — a 9th sweep evicts the tail, which the device's stored token repairs
  const many = Array.from({ length: 9 }, (_, i) => `sw_${i}`)
    .reduce((l, id) => withSweep(l, id, 'member'), null)
  expect(many).toHaveLength(8)
  expect(many[0].sweepId).toBe('sw_8')
  expect(many.find((e) => e.sweepId === 'sw_0')).toBeUndefined()
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
  await db2.insert(sweep).values({ id: 'sw_sess', name: 'S', kind: 'token', memberToken: memberTok, adminToken: adminTok, competitionId: 'apifootball:1:2026' })
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

// The whole point of the list: a browser can hold two sweeps at once, and each request
// says which one it means. Without this, opening a second invite silently evicted the
// first and a second tab repointed the first one's next fetch.
test('joining a second sweep keeps the first, and x-sweep-id picks between them', async () => {
  const bTok = newToken()
  await db2.insert(sweep).values({ id: 'sw_two', name: 'Two', kind: 'token', memberToken: bTok, adminToken: newToken(), competitionId: 'apifootball:1:2026' })

  const first = await app2.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberTok } })
  const second = await app2.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'platform.test', cookie: first.headers['set-cookie'] },
    payload: { token: bTok },
  })
  const both = second.headers['set-cookie']

  const who = (extra) => app2.inject({ method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', cookie: both, ...extra } })
  // no header → most recently joined
  expect((await who()).json()).toEqual({ sweepId: 'sw_two', role: 'member' })
  // each sweep still reachable by name — the first was not evicted
  expect((await who({ 'x-sweep-id': 'sw_sess' })).json()).toEqual({ sweepId: 'sw_sess', role: 'member' })
  expect((await who({ 'x-sweep-id': 'sw_two' })).json()).toEqual({ sweepId: 'sw_two', role: 'member' })
})

// Falling back to a different sweep would silently show someone another group's data,
// so a name this browser does not hold is unauthorized, not "here's one you do hold".
test('naming a sweep the browser does not hold resolves to nobody', async () => {
  const s = await app2.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberTok } })
  const who = await app2.inject({
    method: 'GET', url: '/api/whoami',
    headers: { host: 'platform.test', cookie: s.headers['set-cookie'], 'x-sweep-id': 'sw_not_mine' },
  })
  expect(who.json()).toEqual({ sweepId: null, role: null })
})

test('logout ?sweep=<id> leaves that one and keeps the rest', async () => {
  const first = await app2.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberTok } })
  const second = await app2.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'platform.test', cookie: first.headers['set-cookie'] },
    payload: { token: adminTok }, // same sweep, admin link — upgrades in place
  })
  const out = await app2.inject({
    method: 'POST', url: '/api/session/logout?sweep=sw_sess',
    headers: { host: 'platform.test', cookie: second.headers['set-cookie'] },
  })
  const after = await app2.inject({ method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', cookie: out.headers['set-cookie'] ?? '' } })
  expect(after.json()).toEqual({ sweepId: null, role: null })
})
