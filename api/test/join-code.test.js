import { test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq, inArray, isNotNull } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, loginToken } from '../src/db/schema.js'
import { memberCookie } from './helpers/session.js'

const { pool, db } = openTestDb()
const mails = []
const app = buildApp(db, {
  sessionSecret: 'test-secret',
  sendMail: async (to, subject, body, html) => mails.push({ to, subject, body, html }),
})

const EMAILS = ['joiner@x.test', 'seed@example.test', 'other@x.test']
let cookie

beforeAll(async () => { await app.ready(); cookie = await memberCookie(app) })
beforeEach(async () => {
  mails.length = 0
  await db.delete(loginToken).where(inArray(loginToken.email, EMAILS))
})
afterAll(async () => {
  await db.delete(accountSession)
  await db.delete(loginToken).where(inArray(loginToken.email, EMAILS))
  await db.delete(account).where(inArray(account.email, ['joiner@x.test', 'other@x.test']))
  await app.close(); await pool.end()
})

const ask = (email, headers = { cookie }) =>
  app.inject({ method: 'POST', url: '/api/account/login/code', headers, payload: { email } })
const answer = (email, code, headers = { cookie }) =>
  app.inject({ method: 'POST', url: '/api/account/session/code', headers, payload: { email, code } })
const codeOf = (mail) => mail.subject.match(/^(\d{6})/)[1]

test('a code is mailed and the address is normalized', async () => {
  const res = await ask('  Joiner@X.test ')
  expect(res.statusCode).toBe(201)
  expect(res.json()).toEqual({ ok: true })
  expect(mails).toHaveLength(1)
  expect(mails[0].to).toBe('joiner@x.test')
  expect(mails[0].html).toContain(codeOf(mails[0]))
})

// The branch the join journey needs ("already registered → log in") must not be visible
// from outside: an unknown and a known address answer identically.
test('an existing account is indistinguishable from a new one', async () => {
  const a = await ask('joiner@x.test')
  const b = await ask('seed@example.test')
  expect(b.statusCode).toBe(a.statusCode)
  expect(b.json()).toEqual(a.json())
})

test('holding the group link is what lets us send mail at all', async () => {
  const res = await ask('joiner@x.test', {})
  expect(res.statusCode).toBe(401)
  expect(mails).toHaveLength(0)
})

test('asking again burns the first code, so only one is ever live', async () => {
  await ask('joiner@x.test')
  const first = codeOf(mails[0])
  await ask('joiner@x.test')
  const second = codeOf(mails[1])
  expect(second).not.toBe(first)
  expect((await answer('joiner@x.test', first)).statusCode).toBe(401)
  expect((await answer('joiner@x.test', second)).statusCode).toBe(201)
})

test('a correct code mints a session and is spent', async () => {
  await ask('joiner@x.test')
  const code = codeOf(mails[0])
  const res = await answer('joiner@x.test', code)
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.account.email).toBe('joiner@x.test')
  expect(body.accountToken).toBeTruthy()
  expect((await answer('joiner@x.test', code)).statusCode).toBe(401)
})

// A relayed six-digit code must not carry the magic link's set-a-password-without-the-old-one
// grace: 'code' is a distinct provenance, and the password route only trusts 'link'.
test('a code session cannot set a password without the current one', async () => {
  await ask('joiner@x.test')
  const { accountToken } = (await answer('joiner@x.test', codeOf(mails[0]))).json()
  const [sess] = await db.select().from(accountSession).where(eq(accountSession.token, accountToken))
  expect(sess.via).toBe('code')
  const res = await app.inject({
    method: 'POST', url: '/api/account/password',
    headers: { 'x-account-token': accountToken }, payload: { password: 'a-long-password' },
  })
  expect(res.statusCode).toBe(403)
})

test('a wrong code is refused, counted, and burnt on the fifth try', async () => {
  await ask('joiner@x.test')
  const real = codeOf(mails[0])
  const wrong = real === '000000' ? '111111' : '000000'
  for (let i = 0; i < 4; i++) expect((await answer('joiner@x.test', wrong)).statusCode).toBe(401)
  const [row] = await db.select().from(loginToken).where(eq(loginToken.email, 'joiner@x.test'))
  expect(row.attempts).toBe(4)
  expect(row.usedAt).toBeNull()
  expect((await answer('joiner@x.test', wrong)).statusCode).toBe(401)
  // the fifth guess kills the row, so the real code is dead too
  expect((await answer('joiner@x.test', real)).statusCode).toBe(401)
})

test('an expired code is refused', async () => {
  await ask('joiner@x.test')
  const code = codeOf(mails[0])
  await db.update(loginToken).set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(loginToken.email, 'joiner@x.test'))
  expect((await answer('joiner@x.test', code)).statusCode).toBe(401)
})

// The two flows share one table. A join code must never touch a sign-in link's row.
test("a magic link is untouched by any amount of code guessing", async () => {
  await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'joiner@x.test' } })
  const link = await db.select().from(loginToken).where(eq(loginToken.email, 'joiner@x.test'))
  expect(link).toHaveLength(1)
  expect(link[0].code).toBeNull()

  await ask('joiner@x.test')   // mints a coded row alongside it
  for (let i = 0; i < 6; i++) await answer('joiner@x.test', '000000')

  const [after] = await db.select().from(loginToken).where(eq(loginToken.token, link[0].token))
  expect(after.usedAt).toBeNull()
  expect(after.attempts).toBe(0)
  // and it still redeems
  const res = await app.inject({ method: 'POST', url: '/api/account/session', payload: { token: link[0].token } })
  expect(res.statusCode).toBe(201)
})

test('a third live code in fifteen minutes sends nothing, and still says ok', async () => {
  for (let i = 0; i < 3; i++) await ask('other@x.test')
  expect(mails.length).toBeLessThanOrEqual(3)
  mails.length = 0
  // three were minted but each burns the last, so the cap counts spent rows too
  const res = await ask('other@x.test')
  expect(res.statusCode).toBe(201)
  expect(res.json()).toEqual({ ok: true })
  expect(mails).toHaveLength(0)
  const live = await db.select().from(loginToken)
    .where(eq(loginToken.email, 'other@x.test')).where(isNotNull(loginToken.code))
  expect(live.length).toBeGreaterThan(0)
})
