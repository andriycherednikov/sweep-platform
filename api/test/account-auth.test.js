import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, loginToken } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const mails = []
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  sendMail: async (to, subject, body) => mails.push({ to, subject, body }),
})
beforeAll(async () => { await app.ready() })
afterAll(async () => {
  await db.delete(accountSession)
  await db.delete(loginToken)
  await db.delete(account).where(inArray(account.email, ['ada@x.test', 'noone@x.test']))
  await app.close(); await pool.end()
})

const linkToken = (body) => body.match(/\/account\/login\/([0-9A-Za-z]+)/)[1]

test('login → emailed link token → session → whoami', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: '  Ada@X.test ' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
  expect(mails).toHaveLength(1)
  expect(mails[0].to).toBe('ada@x.test') // normalized
  const token = linkToken(mails[0].body)

  const sess = await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })
  expect(sess.statusCode).toBe(201)
  const { accountToken, account: acc } = sess.json()
  expect(acc.email).toBe('ada@x.test')
  expect(accountToken).toMatch(/^[0-9A-Za-z]{22}$/)

  const who = await app.inject({ method: 'GET', url: '/api/account', headers: { 'x-account-token': accountToken } })
  expect(who.statusCode).toBe(200)
  expect(who.json()).toMatchObject({ id: acc.id, email: 'ada@x.test' })

  // the link is single-use
  expect((await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })).statusCode).toBe(401)
})

test('second login for the same email reuses the account (upsert by email)', async () => {
  await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'ada@x.test' } })
  const token = linkToken(mails.at(-1).body)
  const sess = await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })
  const accounts = await db.select().from(account).where(eq(account.email, 'ada@x.test'))
  expect(accounts).toHaveLength(1)
  expect(sess.json().account.id).toBe(accounts[0].id)
})

test('expired link and expired session are refused; login never leaks existence', async () => {
  const third = await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'noone@x.test' } })
  expect(third.json()).toEqual({ ok: true }) // same answer whether or not an account exists
  const token = linkToken(mails.at(-1).body)
  await db.update(loginToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginToken.token, token))
  expect((await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })).statusCode).toBe(401)

  const [acc] = await db.select().from(account).where(eq(account.email, 'ada@x.test'))
  await db.insert(accountSession).values({ token: 'expiredsess', accountId: acc.id, expiresAt: new Date(Date.now() - 1000) })
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: { 'x-account-token': 'expiredsess' } })).statusCode).toBe(401)
  expect((await app.inject({ method: 'GET', url: '/api/account' })).statusCode).toBe(401) // no header
})
