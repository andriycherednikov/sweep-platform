// api/test/account-profile.test.js — editing the account itself: the name it greets you
// by, and the address it signs you in with.
import { test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, loginToken } from '../src/db/schema.js'
import { ownerHeaders } from './helpers/session.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
const ME = 'ac_profile_me'
const OTHER = 'ac_profile_other'
let auth

beforeAll(async () => { await app.ready() })
beforeEach(async () => {
  await db.delete(accountSession).where(eq(accountSession.accountId, ME))
  await db.delete(account).where(eq(account.id, ME))
  await db.delete(account).where(eq(account.id, OTHER))
  await db.insert(account).values({ id: ME, email: 'me@profile.test', name: 'Old Name' })
  await db.insert(account).values({ id: OTHER, email: 'taken@profile.test' })
  auth = await ownerHeaders(db, ME)
})
afterAll(async () => {
  await db.delete(loginToken).where(eq(loginToken.accountId, ME))
  await db.delete(accountSession).where(eq(accountSession.accountId, ME))
  await db.delete(account).where(eq(account.id, ME))
  await db.delete(account).where(eq(account.id, OTHER))
  await app.close(); await pool.end()
})

test('the name can be changed, and comes back on the next read', async () => {
  const res = await app.inject({ method: 'PATCH', url: '/api/account', headers: auth, payload: { name: 'New Name' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ name: 'New Name', email: 'me@profile.test' })
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: auth })).json().name).toBe('New Name')
})

// The address IS the credential, so it cannot just be overwritten: the new one has to be
// proven first, exactly the way signing in proves one.
test('asking to change the address does not change it yet — it mails the new one', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'New@Profile.Test' } })
  expect(res.statusCode).toBe(202)
  const [acc] = await db.select().from(account).where(eq(account.id, ME))
  expect(acc.email).toBe('me@profile.test') // untouched until confirmed
  const [tok] = await db.select().from(loginToken).where(eq(loginToken.accountId, ME))
  expect(tok.email).toBe('new@profile.test') // normalised, and addressed to the NEW one
})

test('confirming the token moves the address', async () => {
  await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'new@profile.test' } })
  const [tok] = await db.select().from(loginToken).where(eq(loginToken.accountId, ME))
  const res = await app.inject({ method: 'POST', url: '/api/account/email/confirm', headers: auth, payload: { token: tok.token } })
  expect(res.statusCode).toBe(200)
  const [acc] = await db.select().from(account).where(eq(account.id, ME))
  expect(acc.email).toBe('new@profile.test')
})

test('a token cannot be spent twice', async () => {
  await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'new@profile.test' } })
  const [tok] = await db.select().from(loginToken).where(eq(loginToken.accountId, ME))
  await app.inject({ method: 'POST', url: '/api/account/email/confirm', headers: auth, payload: { token: tok.token } })
  const again = await app.inject({ method: 'POST', url: '/api/account/email/confirm', headers: auth, payload: { token: tok.token } })
  expect(again.statusCode).toBe(401)
})

// Two accounts on one address would make signing in ambiguous — and worse, claiming
// somebody else's address is how you take their sweeps.
test('an address another account already holds is refused', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'taken@profile.test' } })
  expect(res.statusCode).toBe(409)
  expect(await db.select().from(loginToken).where(eq(loginToken.accountId, ME))).toHaveLength(0)
})

// ...and it has to be refused at confirm time too: the address can be taken in between.
test('an address taken between the request and the confirm is refused', async () => {
  await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'later@profile.test' } })
  const [tok] = await db.select().from(loginToken).where(eq(loginToken.accountId, ME))
  await db.update(account).set({ email: 'later@profile.test' }).where(eq(account.id, OTHER))
  const res = await app.inject({ method: 'POST', url: '/api/account/email/confirm', headers: auth, payload: { token: tok.token } })
  expect(res.statusCode).toBe(409)
  const [acc] = await db.select().from(account).where(eq(account.id, ME))
  expect(acc.email).toBe('me@profile.test')
})

// A sign-in link must not double as an email-change link, or clicking one would move
// somebody's address instead of signing them in.
test('a plain sign-in token cannot be spent as an email change', async () => {
  await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'someone@profile.test' } })
  const [plain] = await db.select().from(loginToken).where(eq(loginToken.email, 'someone@profile.test'))
  const res = await app.inject({ method: 'POST', url: '/api/account/email/confirm', headers: auth, payload: { token: plain.token } })
  expect(res.statusCode).toBe(401)
  await db.delete(loginToken).where(eq(loginToken.email, 'someone@profile.test'))
})

// ...and the reverse: an email-change token must not mint a session for the new address.
test('an email-change token cannot be spent as a sign-in', async () => {
  const ask = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'new@profile.test' } })
  expect(ask.statusCode).toBe(202)
  const [tok] = await db.select().from(loginToken).where(eq(loginToken.accountId, ME))
  const res = await app.inject({ method: 'POST', url: '/api/account/session', payload: { token: tok.token } })
  expect(res.statusCode).toBe(401)
})
