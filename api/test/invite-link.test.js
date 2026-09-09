import { test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, loginToken, person, ownership, competitor } from '../src/db/schema.js'
import { adminHeaders, seatFor, releaseSeat } from './helpers/session.js'

const { pool, db } = openTestDb()
const mails = []
const app = buildApp(db, {
  sessionSecret: 'test-secret', publicOrigin: 'https://sweep.test',
  sendMail: async (to, subject, body, html) => mails.push({ to, subject, body, html }),
})
const EMAILS = ['invitee@x.test', 'already@x.test']
let auth

beforeAll(async () => { await app.ready(); auth = await adminHeaders(app, db, 'default', 'ac_seed') })
beforeEach(async () => {
  mails.length = 0
  await db.delete(loginToken).where(inArray(loginToken.email, EMAILS))
  const rows = await db.select().from(person).where(inArray(person.email, EMAILS))
  for (const r of rows) await db.delete(person).where(eq(person.id, r.id))
  await dropAccounts()
})

// account_session has no cascade, so sessions go before the accounts they point at.
async function dropAccounts() {
  const accs = await db.select().from(account).where(inArray(account.email, EMAILS))
  for (const a of [...accs.map((a) => a.id), 'ac_inv']) {
    await db.delete(accountSession).where(eq(accountSession.accountId, a))
    await db.delete(account).where(eq(account.id, a))
  }
}
afterAll(async () => {
  await db.delete(loginToken).where(inArray(loginToken.email, EMAILS))
  const rows = await db.select().from(person).where(inArray(person.email, EMAILS))
  for (const r of rows) await db.delete(person).where(eq(person.id, r.id))
  await dropAccounts()
  await app.close(); await pool.end()
})

const invite = (email) => app.inject({
  method: 'POST', url: '/api/admin/people', headers: auth,
  payload: { name: 'Invited', short: 'Inv', initials: 'IN', av: '#123456', email },
})
const tokenOf = (mail) => mail.body.match(/\/i\/([0-9A-Za-z]+)/)[1]
const redeem = (token) => app.inject({ method: 'POST', url: '/api/account/session/invite', payload: { token } })

test('an invite mails a link to the seat, not the group link', async () => {
  await invite('invitee@x.test')
  expect(mails).toHaveLength(1)
  expect(mails[0].to).toBe('invitee@x.test')
  expect(mails[0].body).toMatch(/https:\/\/sweep\.test\/i\/[0-9A-Za-z]+/)
  const [row] = await db.select().from(loginToken).where(eq(loginToken.email, 'invitee@x.test'))
  expect(row.personId).toBeTruthy()
  expect(row.code).toBeNull() // not a join code: no six digits to guess
})

// The whole point: they arrive already themselves, with no email step to repeat.
test('redeeming signs the address in and claims that seat', async () => {
  const created = (await invite('invitee@x.test')).json()
  const res = await redeem(tokenOf(mails[0]))
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.sweepId).toBe('default')
  expect(body.person.id).toBe(created.id)
  expect(body.account.email).toBe('invitee@x.test')
  // and it hands over a sweep session, so the link is the only step
  expect(String(res.headers['set-cookie'])).toMatch(/sweep_session=/)

  const [p] = await db.select().from(person).where(eq(person.id, created.id))
  const [acc] = await db.select().from(account).where(eq(account.email, 'invitee@x.test'))
  expect(p.accountId).toBe(acc.id)
  expect(p.claimedAt).toBeInstanceOf(Date)
})

test('the seat keeps the teams already drawn to it', async () => {
  const created = (await invite('invitee@x.test')).json()
  const [cp] = await db.select().from(competitor).limit(1)
  await db.insert(ownership).values({ sweepId: 'default', personId: created.id, competitorId: cp.id })
  await redeem(tokenOf(mails[0]))
  expect(await db.select().from(ownership).where(eq(ownership.personId, created.id))).toHaveLength(1)
})

test('an invite works once', async () => {
  await invite('invitee@x.test')
  const token = tokenOf(mails[0])
  expect((await redeem(token)).statusCode).toBe(201)
  expect((await redeem(token)).statusCode).toBe(401)
})

test('an expired invite is refused', async () => {
  await invite('invitee@x.test')
  const token = tokenOf(mails[0])
  await db.update(loginToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginToken.token, token))
  expect((await redeem(token)).statusCode).toBe(401)
})

test('a garbage token is refused', async () => {
  expect((await redeem('nope_not_a_token')).statusCode).toBe(401)
})

// One account, one seat per sweep: an invite to somebody who is already in lands them on
// the seat they already hold rather than blowing up on the unique index.
test('an invite to somebody already in the sweep signs them into their own seat', async () => {
  const mine = (await app.inject({
    method: 'POST', url: '/api/admin/people', headers: auth,
    payload: { name: 'Already', short: 'Al', initials: 'AL', av: '#123456', email: 'already@x.test' },
  })).json()
  await seatFor(db, mine.id, { accountId: 'ac_inv', email: 'already@x.test' })

  // every new seat now carries an address, so creating one sends an invite of its own —
  // drop it, the mail under test is the SECOND invite to the same address
  mails.length = 0
  const second = (await invite('already@x.test')).json()
  const res = await redeem(tokenOf(mails[0]))
  expect(res.statusCode).toBe(201)
  expect(res.json().person.id).toBe(mine.id) // their existing seat, not the new row
  const [dupe] = await db.select().from(person).where(eq(person.id, second.id))
  expect(dupe.accountId).toBeNull()

  await releaseSeat(db, mine.id, 'ac_inv')
  await db.delete(person).where(eq(person.id, mine.id))
})

test('resending an invite mints a fresh link and kills the old one', async () => {
  const created = (await invite('invitee@x.test')).json()
  const first = tokenOf(mails[0])
  mails.length = 0
  await app.inject({
    method: 'PATCH', url: `/api/admin/people/${created.id}`, headers: auth,
    payload: { email: 'invitee@x.test' },
  })
  const second = tokenOf(mails[0])
  expect(second).not.toBe(first)
  expect((await redeem(first)).statusCode).toBe(401)
  expect((await redeem(second)).statusCode).toBe(201)
})
