import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { account, accountSession, person } from '../src/db/schema.js'
import { openTestDb } from './helpers/db.js'
import { memberClient, seatFor, releaseSeat, ownerHeaders } from './helpers/session.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
let client, seat
beforeAll(async () => { client = await memberClient(app); seat = await seatFor(db, 'p4') })
afterAll(async () => { await releaseSeat(db, 'p4'); await app.close(); await pool.end() })

test('GET /api/bootstrap returns teams, people, ownership, scoring', async () => {
  const res = await client.inject({ method: 'GET', url: '/api/bootstrap' })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.teams).toHaveLength(48)
  expect(body.people).toHaveLength(16)
  expect(body.scoring.rule).toBe('top3')
  const andriy = body.people.find((p) => p.id === 'p4')
  expect(body.ownership[andriy.id]).toContain('hr')
})

test('bootstrap teams carry a squad field (null by default)', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.teams.every((t) => 'squad' in t)).toBe(true)
  expect(body.teams[0].squad).toBeNull()
})

test('bootstrap returns the current sweep id and display name (D7a)', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.sweep).toEqual({ id: 'default', name: 'The Sweep', role: 'member' })
})

test('bootstrap sweep carries the viewer role (drives admin-entry visibility)', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  // unauthenticated default-host viewer resolves to the member role
  expect(body.sweep.role).toBe('member')
})

test('bootstrap people carry a createdAt timestamp (for sort-by-when-added)', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  const p = body.people[0]
  expect(p.createdAt).toBeTruthy()
  expect(Number.isNaN(Date.parse(p.createdAt))).toBe(false)
})

test('bootstrap names the caller, so the client never has to be told who it is', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap', headers: seat })).json()
  expect(body.meId).toBe('p4')
})

test('a link-holder who has not joined is nobody', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.meId).toBeNull()
})

test('an ejected member is nobody, even holding their own token', async () => {
  await db.update(person).set({ ejectedAt: new Date() }).where(eq(person.id, 'p4'))
  try {
    const body = (await client.inject({ method: 'GET', url: '/api/bootstrap', headers: seat })).json()
    expect(body.meId).toBeNull()
    expect(body.people.find((p) => p.id === 'p4').ejected).toBe(true)
  } finally {
    await db.update(person).set({ ejectedAt: null }).where(eq(person.id, 'p4'))
  }
})

test('every person says whether their seat is claimed', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap', headers: seat })).json()
  expect(body.people.find((p) => p.id === 'p4').claimed).toBe(true)
  expect(body.people.every((p) => 'claimed' in p && 'ejected' in p)).toBe(true)
})

// Addresses are the owner's to see, not the group's.
test('members never see each other addresses; the owner does', async () => {
  const asMember = (await client.inject({ method: 'GET', url: '/api/bootstrap', headers: seat })).json()
  expect(asMember.people.every((p) => !('email' in p))).toBe(true)

  const asOwner = (await client.inject({
    method: 'GET', url: '/api/bootstrap', headers: await ownerHeaders(db),
  })).json()
  expect(asOwner.sweep.role).toBe('admin')
  expect(asOwner.people.every((p) => 'email' in p && 'claimedAt' in p)).toBe(true)
  expect(asOwner.people.find((p) => p.id === 'p4').email).toBe('ac_seat_p4@example.test')
})

// An owner who spun a sweep up from the console has an account but no seat, and the
// identity chip could only say "Nobody yet" at them. Their own address is not a leak.
test('bootstrap names the caller even when they hold no seat', async () => {
  await db.insert(account).values({ id: 'ac_seatless', email: 'seatless@x.test' }).onConflictDoNothing()
  const auth = await ownerHeaders(db, 'ac_seatless')
  try {
    const body = (await client.inject({ method: 'GET', url: '/api/bootstrap', headers: auth })).json()
    expect(body.meId).toBeNull()                                   // no seat...
    expect(body.account).toEqual({ email: 'seatless@x.test', name: null }) // ...but we know who they are
  } finally {
    await db.delete(accountSession).where(eq(accountSession.accountId, 'ac_seatless'))
    await db.delete(account).where(eq(account.id, 'ac_seatless'))
  }
})

test('bootstrap carries no account for a caller who is not signed in at all', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.account).toBeNull()
})
