// api/test/optout.test.js — server-side Wagers self-exclusion + admin visibility
import { expect, test, afterAll, beforeAll, beforeEach, describe } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { memberClient, seatFor, releaseSeat } from './helpers/session.js'
import { account, person } from '../src/db/schema.js'
import { untilFor, isExcluded, extendUntil, FOREVER } from '../src/optout.js'

describe('optout helpers', () => {
  test('untilFor resolves day windows and forever; rejects unknown', () => {
    const now = 1_000_000_000_000
    expect(untilFor('1d', now).getTime()).toBe(now + 86_400_000)
    expect(untilFor('14d', now).getTime()).toBe(now + 14 * 86_400_000)
    expect(untilFor('forever')).toEqual(FOREVER)
    expect(untilFor('bogus')).toBe(null)
  })
  test('isExcluded is true only while the window is in the future', () => {
    const now = 1_000_000_000_000
    expect(isExcluded({ excludedUntil: new Date(now + 1000) }, now)).toBe(true)
    expect(isExcluded({ excludedUntil: new Date(now - 1000) }, now)).toBe(false)
    expect(isExcluded({ excludedUntil: null }, now)).toBe(false)
    expect(isExcluded({}, now)).toBe(false)
  })
  test('extendUntil never shortens an existing window', () => {
    const soon = new Date(2_000), later = new Date(9_000)
    expect(extendUntil(later, soon)).toEqual(later) // keep the longer existing window
    expect(extendUntil(soon, later)).toEqual(later) // adopt the longer requested window
    expect(extendUntil(null, soon)).toEqual(soon)
  })
})

const { pool, db } = openTestDb()
let dir, app, client, seat
const PID = 'optp'
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-optout-'))
  app = buildApp(db, { photosDir: dir, sessionSecret: 's' })
  await app.ready()
  client = await memberClient(app)
})
afterAll(async () => {
  await releaseSeat(db, PID)
  await db.delete(person).where(eq(person.id, PID)) // don't leak the test person into other suites' counts
  await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await db.delete(person).where(eq(person.id, PID))
  await db.insert(person).values({ id: PID, sweepId: 'default', name: 'Opt Out', short: 'Opt', initials: 'OO', avColor: '#abc' })
  seat = await seatFor(db, PID)
})

// The caller excludes their own seat: the account token says who that is.
const optout = (payload, headers = seat) => client.inject({ method: 'POST', url: '/api/optout', headers, payload })

test('a member can self-exclude for a fixed window; the person is then marked excluded', async () => {
  const res = await optout({ duration: '7d' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ personId: PID, excluded: true })
  const [row] = await db.select().from(person).where(eq(person.id, PID))
  expect(row.excludedUntil).toBeInstanceOf(Date)
  expect(row.excludedUntil.getTime()).toBeGreaterThan(Date.now())
})

test('the excluded flag flows through /api/bootstrap for the admin list', async () => {
  await optout({ duration: '3d' })
  const b = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(b.people.find((p) => p.id === PID)).toMatchObject({ excluded: true })
})

test('forever stores the sentinel and reads back as excluded', async () => {
  await optout({ duration: 'forever' })
  const [row] = await db.select().from(person).where(eq(person.id, PID))
  expect(row.excludedUntil.getTime()).toBe(FOREVER.getTime())
  expect(isExcluded(row)).toBe(true)
})

test('binding: a shorter window cannot reverse/shorten an existing forever exclusion', async () => {
  await optout({ duration: 'forever' })
  const res = await optout({ duration: '1d' })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(person).where(eq(person.id, PID))
  expect(row.excludedUntil.getTime()).toBe(FOREVER.getTime()) // unchanged
})

test('an expired window serializes as not excluded', async () => {
  await db.update(person).set({ excludedUntil: new Date(Date.now() - 86_400_000) }).where(eq(person.id, PID))
  const b = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(b.people.find((p) => p.id === PID)).toMatchObject({ excluded: false })
})

// The defect this closes: barring another member was one request away, and nothing at
// any role could undo it.
test('a personId in the body cannot bar anyone else', async () => {
  await db.insert(person).values({ id: 'optvictim', sweepId: 'default', name: 'Victim', short: 'Vic', initials: 'VI', avColor: '#abc' })
  const res = await optout({ personId: 'optvictim', duration: 'forever' })
  expect(res.statusCode).toBe(200)
  expect(res.json().personId).toBe(PID)
  const [victim] = await db.select().from(person).where(eq(person.id, 'optvictim'))
  expect(victim.excludedUntil).toBeNull()
  await db.delete(person).where(eq(person.id, 'optvictim'))
})

test('a link-holder with no seat cannot opt anyone out', async () => {
  const res = await optout({ duration: '7d' }, {})
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'no_seat' })
})

test('an unknown duration is rejected by schema', async () => {
  const res = await optout({ duration: '30d' })
  expect(res.statusCode).toBe(400)
})
