import { expect, test, afterAll } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { SWEEP_COOKIE, signSweepCookie, parseSweepCookie, withSweep, readSweepList } from '../src/sweeps/auth.js'

test('sign then parse round-trips the id list', async () => {
  const app = Fastify()
  await app.register(cookie, { secret: 'test-secret' })
  await app.ready()
  const signed = app.signCookie(signSweepCookie(['abc123']))
  const un = app.unsignCookie(signed)
  expect(un.valid).toBe(true)
  expect(parseSweepCookie(un.value)).toEqual(['abc123'])
  await app.close()
})

test('parseSweepCookie returns null when there is nothing to read', () => {
  expect(parseSweepCookie('')).toBeNull()
  expect(parseSweepCookie(',,')).toBeNull()
  expect(parseSweepCookie(undefined)).toBeNull()
})

// Cookies minted before this change are `id:role` pairs. Dropping the role must not
// sign every live session out on deploy.
test('a legacy id:role cookie value still parses to ids', () => {
  expect(parseSweepCookie('sw_a:member,sw_b')).toEqual(['sw_a', 'sw_b'])
})

test('a list round-trips in order, most-recent first', () => {
  const list = ['sw_b', 'sw_a']
  expect(parseSweepCookie(signSweepCookie(list))).toEqual(list)
})

// The cookie carries no role any more, so its SIGNATURE is the whole of the check: it is
// all that stands between a hand-typed `sweep_session=sw_victim` and a full read of that
// group's people, ownership, photos, social and wallets. What decides must be `valid`,
// not the value that arrives beside it — @fastify/cookie happens to null the value on a
// bad signature, so a `un.valid` check dropped here would look harmless until the day
// the signer (or a swap for another one) hands the parsed value back anyway.
test('readSweepList trusts the signature verdict, not the value beside it', () => {
  const req = { cookies: { [SWEEP_COOKIE]: 'sw_victim.forged-signature' } }
  const forged = { unsignCookie: () => ({ valid: false, renew: false, value: 'sw_victim' }) }
  expect(readSweepList(forged, req)).toBeNull()
  const genuine = { unsignCookie: () => ({ valid: true, renew: false, value: 'sw_victim' }) }
  expect(readSweepList(genuine, req)).toEqual(['sw_victim'])
})

test('withSweep moves a sweep to the front and caps the list', () => {
  const a = withSweep(null, 'sw_a')
  expect(a).toEqual(['sw_a'])
  const b = withSweep(a, 'sw_b')
  expect(b).toEqual(['sw_b', 'sw_a'])
  // re-opening sw_a promotes it without duplicating
  expect(withSweep(b, 'sw_a')).toEqual(['sw_a', 'sw_b'])
  // ponytail: cap 8 — a 9th sweep evicts the tail, which the device's stored token repairs
  const many = Array.from({ length: 9 }, (_, i) => `sw_${i}`).reduce((l, id) => withSweep(l, id), null)
  expect(many).toHaveLength(8)
  expect(many[0]).toBe('sw_8')
  expect(many).not.toContain('sw_0')
})

import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { newToken } from '../src/sweeps/tokens.js'
import { sweep } from '../src/db/schema.js'

const { pool: pool2, db: db2 } = openTestDb()
const memberTok = newToken(), adminTok = newToken()
const app2 = buildApp(db2, { sessionSecret: 'test-secret' })
afterAll(async () => { await app2.close(); await pool2.end() })

test('POST /api/session with a member token sets a member-scoped cookie', async () => {
  await app2.ready()
  await db2.insert(sweep).values({ id: 'sw_sess', name: 'S', kind: 'token', memberToken: memberTok, competitionId: 'apifootball:1:2026' })
  const res = await app2.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberTok },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ sweepId: 'sw_sess' })
  const cookie = res.headers['set-cookie']
  expect(cookie).toMatch(/sweep_session=/)
  const who = await app2.inject({ method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', cookie } })
  expect(who.json()).toEqual({ sweepId: 'sw_sess', role: 'member' })
})

test('a former admin token no longer opens anything', async () => {
  const res = await app2.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: adminTok },
  })
  expect(res.statusCode).toBe(404)
})

test('an unknown token is 404', async () => {
  const bad = await app2.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: newToken() } })
  expect(bad.statusCode).toBe(404)
})

// The whole point of the list: a browser can hold two sweeps at once, and each request
// says which one it means. Without this, opening a second invite silently evicted the
// first and a second tab repointed the first one's next fetch.
test('joining a second sweep keeps the first, and x-sweep-id picks between them', async () => {
  const bTok = newToken()
  await db2.insert(sweep).values({ id: 'sw_two', name: 'Two', kind: 'token', memberToken: bTok, competitionId: 'apifootball:1:2026' })

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

// End to end, over the wire: neither a cookie nobody signed nor a real signature with a
// different id under it may resolve to a sweep.
test('a forged sweep cookie resolves to nobody', async () => {
  const who = (cookie) => app2.inject({
    method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', cookie },
  })
  expect((await who(`${SWEEP_COOKIE}=sw_sess`)).json()).toEqual({ sweepId: null, role: null })

  const real = await app2.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberTok },
  })
  const tampered = real.headers['set-cookie'].replace('sw_sess', 'sw_two')
  expect(tampered).toContain('sw_two')  // the swap actually happened
  expect((await who(tampered)).json()).toEqual({ sweepId: null, role: null })
})

test('logout ?sweep=<id> leaves that one and keeps the rest', async () => {
  const first = await app2.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberTok } })
  const out = await app2.inject({
    method: 'POST', url: '/api/session/logout?sweep=sw_sess',
    headers: { host: 'platform.test', cookie: first.headers['set-cookie'] },
  })
  const after = await app2.inject({ method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', cookie: out.headers['set-cookie'] ?? '' } })
  expect(after.json()).toEqual({ sweepId: null, role: null })
})
