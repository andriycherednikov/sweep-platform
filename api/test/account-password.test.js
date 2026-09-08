import { expect, test, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account, accountSession } from '../src/db/schema.js'
import { newToken } from '../src/sweeps/tokens.js'
import { SESSION_TTL_MS } from '../src/accounts/auth.js'
import { hashPassword } from '../src/auth.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_pw', email: 'pw@example.test', subscriptionStatus: 'active',
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

const setPw = (headers, payload) =>
  app.inject({ method: 'POST', url: '/api/account/password', headers, payload })
const login = (payload) =>
  app.inject({ method: 'POST', url: '/api/account/password/session', payload })

test('a fresh link session may set a password without knowing the old one', async () => {
  const res = await setPw(await ownerHeaders(db, 'ac_pw'), { password: 'a-good-passphrase' })
  expect(res.statusCode).toBe(204)
})

test('the password then signs in, and the session works', async () => {
  const res = await login({ email: 'pw@example.test', password: 'a-good-passphrase' })
  expect(res.statusCode).toBe(201)
  const me = await app.inject({
    method: 'GET', url: '/api/account',
    headers: { 'x-account-token': res.json().accountToken },
  })
  expect(me.json()).toMatchObject({ id: 'ac_pw', hasPassword: true })
})

// An attacker must not be able to tell which addresses have accounts.
test('a wrong password and an unknown email are indistinguishable', async () => {
  const wrong = await login({ email: 'pw@example.test', password: 'not-the-passphrase' })
  const nobody = await login({ email: 'nobody@example.test', password: 'not-the-passphrase' })
  expect(wrong.statusCode).toBe(401)
  expect(nobody.statusCode).toBe(401)
  expect(wrong.json()).toEqual(nobody.json())
})

// Without this, a stolen 90-day token becomes a PERMANENT password.
test('changing a password on a stale session requires the current one', async () => {
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId: 'ac_pw', via: 'password',
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  const headers = { 'x-account-token': token }
  expect((await setPw(headers, { password: 'another-passphrase' })).statusCode).toBe(403)
  expect((await setPw(headers, { password: 'another-passphrase', current: 'nope' })).statusCode).toBe(401)
  expect((await setPw(headers, { password: 'another-passphrase', current: 'a-good-passphrase' })).statusCode).toBe(204)
})

// The freshness exemption must not be a free pass just because there's no old
// password to check against — a stolen 90-day token could otherwise plant a
// password on an account that never had one, and keep working past a sign-out-everywhere.
test('a stale link session cannot bootstrap a password either', async () => {
  await db.insert(account).values({
    id: 'ac_pw_bootstrap', email: 'pw-bootstrap@example.test',
  }).onConflictDoNothing()
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId: 'ac_pw_bootstrap', via: 'link',
    createdAt: new Date(Date.now() - 20 * 60_000),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  const res = await setPw({ 'x-account-token': token }, { password: 'a-good-passphrase' })
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'reauth_required' })
})

// The grace window has a time limit, not just a via check.
test('a stale link session cannot change an existing password without current either', async () => {
  await db.insert(account).values({
    id: 'ac_pw_stale', email: 'pw-stale@example.test', passwordHash: await hashPassword('original-passphrase'),
  }).onConflictDoNothing()
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId: 'ac_pw_stale', via: 'link',
    createdAt: new Date(Date.now() - 20 * 60_000),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  const res = await setPw({ 'x-account-token': token }, { password: 'a-newer-passphrase' })
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'current_required' })
})

// hashPassword's cap is 72 BYTES; the schema's maxLength is 72 UTF-16 units — a
// multi-byte password can clear the schema and still overflow the hash.
test('a 72-character multi-byte password is rejected cleanly, not with a 500', async () => {
  const res = await setPw(await ownerHeaders(db, 'ac_pw'), { password: 'д'.repeat(72) })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'password_too_long' })
})

test('sign out drops this session only; sign out everywhere drops the rest', async () => {
  const a = await ownerHeaders(db, 'ac_pw')
  const b = await ownerHeaders(db, 'ac_pw')
  expect((await app.inject({ method: 'DELETE', url: '/api/account/session', headers: a })).statusCode).toBe(204)
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: a })).statusCode).toBe(401)
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: b })).statusCode).toBe(200)
  expect((await app.inject({ method: 'DELETE', url: '/api/account/sessions', headers: b })).statusCode).toBe(204)
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: b })).statusCode).toBe(401)
  const left = await db.select().from(accountSession).where(eq(accountSession.accountId, 'ac_pw'))
  expect(left).toHaveLength(0)
})
