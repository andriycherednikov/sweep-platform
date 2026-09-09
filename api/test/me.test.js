import { test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq, and, inArray, like } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, competition, person, ownership, competitor, sweep } from '../src/db/schema.js'
import { memberCookie, ownerHeaders } from './helpers/session.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', sendMail: async () => {} })
const H = { host: 'platform.test' }
const COMP = 'apibasketball:12:melapsed'

let cookie, lapsedCookie
const ACCOUNTS = ['ac_me_1', 'ac_me_2', 'ac_me_3']

beforeAll(async () => {
  await app.ready()
  cookie = await memberCookie(app)
  for (const [i, id] of ACCOUNTS.entries()) {
    await db.insert(account).values({ id, email: `me${i + 1}@x.test` }).onConflictDoNothing()
  }
  await db.insert(account).values({ id: 'ac_me_ro', email: 'mero@x.test', subscriptionStatus: 'canceled' }).onConflictDoNothing()
  await db.insert(competition).values({ id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'melapsed', format: 'league', name: 'RO' }).onConflictDoNothing()
  await db.insert(sweep).values({ id: 'sw_me_ro', name: 'Lapsed', kind: 'token', memberToken: 'memerolapsed00000000', competitionId: COMP, accountId: 'ac_me_ro' }).onConflictDoNothing()
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: H, payload: { token: 'memerolapsed00000000' } })
  lapsedCookie = res.headers['set-cookie']
})

async function scrub() {
  const rows = await db.select().from(person).where(inArray(person.accountId, ACCOUNTS))
  for (const r of rows) await db.delete(person).where(eq(person.id, r.id))
  await db.delete(person).where(like(person.id, 'pn_metest%'))
}
beforeEach(scrub)
afterAll(async () => {
  await scrub()
  await db.delete(accountSession).where(inArray(accountSession.accountId, [...ACCOUNTS, 'ac_me_ro']))
  await db.delete(sweep).where(eq(sweep.id, 'sw_me_ro'))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(account).where(inArray(account.id, [...ACCOUNTS, 'ac_me_ro']))
  await app.close(); await pool.end()
})

const join = async (accountId, name, extra = {}) => app.inject({
  method: 'POST', url: '/api/me',
  headers: { ...H, cookie, ...(await ownerHeaders(db, accountId)), ...extra },
  payload: { name },
})

test('a new member gets a seat, with short/initials/colour derived from the name', async () => {
  const res = await join('ac_me_1', 'Ada Lovelace')
  expect(res.statusCode).toBe(201)
  const p = res.json()
  expect(p.name).toBe('Ada Lovelace')
  expect(p.short).toBe('Ada')
  expect(p.initials).toBe('AD')
  expect(p.av).toMatch(/^#[0-9a-f]{6}$/i)
  const [row] = await db.select().from(person).where(eq(person.id, p.id))
  expect(row.accountId).toBe('ac_me_1')
  expect(row.email).toBe('me1@x.test')
  expect(row.claimedAt).toBeInstanceOf(Date)
})

test('joining again renames the same seat instead of making a second one', async () => {
  const first = (await join('ac_me_1', 'Ada Lovelace')).json()
  const again = await join('ac_me_1', 'Ada L')
  expect(again.statusCode).toBe(200)
  expect(again.json().id).toBe(first.id)
  expect(again.json().short).toBe('Ada')
  const rows = await db.select().from(person).where(eq(person.accountId, 'ac_me_1'))
  expect(rows).toHaveLength(1)
  expect(rows[0].name).toBe('Ada L')
})

// The whole point of inviting by email: the owner sets a seat up and runs the draw, and
// the person walks into it - teams and all - whenever they get round to joining.
test('an invited seat is claimed by its email, keeping the teams already drawn to it', async () => {
  const [cp] = await db.select().from(competitor).limit(1)
  await db.insert(person).values({
    id: 'pn_metest1', sweepId: 'default', name: 'Invited', short: 'Invited', initials: 'IN',
    avColor: '#3b6fd1', email: 'ME1@X.test',
  })
  await db.insert(ownership).values({ sweepId: 'default', personId: 'pn_metest1', competitorId: cp.id })

  const res = await join('ac_me_1', 'Ada Lovelace')
  expect(res.statusCode).toBe(200)
  expect(res.json().id).toBe('pn_metest1')
  const owns = await db.select().from(ownership).where(eq(ownership.personId, 'pn_metest1'))
  expect(owns).toHaveLength(1)
  const rows = await db.select().from(person).where(eq(person.accountId, 'ac_me_1'))
  expect(rows).toHaveLength(1)
})

test('a seat someone else already claimed is never handed over', async () => {
  await db.insert(person).values({
    id: 'pn_metest2', sweepId: 'default', name: 'Taken', short: 'Taken', initials: 'TA',
    avColor: '#3b6fd1', email: 'me2@x.test', accountId: 'ac_me_2', claimedAt: new Date(),
  })
  const res = await join('ac_me_3', 'Third Party')
  expect(res.statusCode).toBe(201)
  expect(res.json().id).not.toBe('pn_metest2')
  const [taken] = await db.select().from(person).where(eq(person.id, 'pn_metest2'))
  expect(taken.accountId).toBe('ac_me_2')
})

test('two devices joining at once end up on one seat', async () => {
  const headers = { ...H, cookie, ...(await ownerHeaders(db, 'ac_me_1')) }
  const call = () => app.inject({ method: 'POST', url: '/api/me', headers, payload: { name: 'Ada' } })
  const results = await Promise.all([call(), call(), call()])
  for (const r of results) expect([200, 201]).toContain(r.statusCode)
  const rows = await db.select().from(person).where(eq(person.accountId, 'ac_me_1'))
  expect(rows).toHaveLength(1)
  expect(new Set(results.map((r) => r.json().id)).size).toBe(1)
})

test('an ejected member cannot rejoin', async () => {
  await db.insert(person).values({
    id: 'pn_metest3', sweepId: 'default', name: 'Gone', short: 'Gone', initials: 'GO',
    avColor: '#3b6fd1', email: 'me1@x.test', accountId: 'ac_me_1',
    claimedAt: new Date(), ejectedAt: new Date(),
  })
  const res = await join('ac_me_1', 'Gone')
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'removed_from_sweep' })
})

test('the sweep cookie alone is not an identity', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/me', headers: { ...H, cookie }, payload: { name: 'Nobody' } })
  expect(res.statusCode).toBe(401)
})

// Sign-in must survive a lapse (members can still look), but the roster must not grow.
test('a lapsed sweep can be signed into, not joined', async () => {
  const auth = await ownerHeaders(db, 'ac_me_1')
  const ask = await app.inject({
    method: 'POST', url: '/api/account/login/code',
    headers: { ...H, cookie: lapsedCookie, ...auth }, payload: { email: 'me1@x.test' },
  })
  expect(ask.statusCode).toBe(201)
  const res = await app.inject({
    method: 'POST', url: '/api/me',
    headers: { ...H, cookie: lapsedCookie, ...auth }, payload: { name: 'Ada' },
  })
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'sweep_readonly' })
})

// account.name was declared and never written by any route, so the account console had
// only an email to show. Taking a seat is the one moment someone tells us their name.
test('taking a seat teaches the account your name', async () => {
  await join('ac_me_1', 'Ada Lovelace')
  const [acc] = await db.select().from(account).where(eq(account.id, 'ac_me_1'))
  expect(acc.name).toBe('Ada Lovelace')
})

test('renaming your seat renames you', async () => {
  await join('ac_me_1', 'Ada Lovelace')
  await join('ac_me_1', 'Augusta Byron')
  const [acc] = await db.select().from(account).where(eq(account.id, 'ac_me_1'))
  expect(acc.name).toBe('Augusta Byron')
})
