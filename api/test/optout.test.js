// api/test/optout.test.js — server-side Wagers self-exclusion + admin visibility
import { expect, test, afterAll, beforeAll, beforeEach, describe } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { person } from '../src/db/schema.js'
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
let dir, app
const PID = 'optp'
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-optout-'))
  app = buildApp(db, { photosDir: dir, sessionSecret: 's' })
  await app.ready()
})
afterAll(async () => {
  await db.delete(person).where(eq(person.id, PID)) // don't leak the test person into other suites' counts
  await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await db.delete(person).where(eq(person.id, PID))
  await db.insert(person).values({ id: PID, sweepId: 'default', name: 'Opt Out', short: 'Opt', initials: 'OO', avColor: '#abc' })
})

// member self-service: an anonymous localhost request resolves to the default sweep as a member
const optout = (payload) => app.inject({ method: 'POST', url: '/api/optout', payload })

test('a member can self-exclude for a fixed window; the person is then marked excluded', async () => {
  const res = await optout({ personId: PID, duration: '7d' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ personId: PID, excluded: true })
  const [row] = await db.select().from(person).where(eq(person.id, PID))
  expect(row.excludedUntil).toBeInstanceOf(Date)
  expect(row.excludedUntil.getTime()).toBeGreaterThan(Date.now())
})

test('the excluded flag flows through /api/bootstrap for the admin list', async () => {
  await optout({ personId: PID, duration: '3d' })
  const b = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(b.people.find((p) => p.id === PID)).toMatchObject({ excluded: true })
})

test('forever stores the sentinel and reads back as excluded', async () => {
  await optout({ personId: PID, duration: 'forever' })
  const [row] = await db.select().from(person).where(eq(person.id, PID))
  expect(row.excludedUntil.getTime()).toBe(FOREVER.getTime())
  expect(isExcluded(row)).toBe(true)
})

test('binding: a shorter window cannot reverse/shorten an existing forever exclusion', async () => {
  await optout({ personId: PID, duration: 'forever' })
  const res = await optout({ personId: PID, duration: '1d' })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(person).where(eq(person.id, PID))
  expect(row.excludedUntil.getTime()).toBe(FOREVER.getTime()) // unchanged
})

test('an expired window serializes as not excluded', async () => {
  await db.update(person).set({ excludedUntil: new Date(Date.now() - 86_400_000) }).where(eq(person.id, PID))
  const b = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(b.people.find((p) => p.id === PID)).toMatchObject({ excluded: false })
})

test('opting out an unknown person is rejected', async () => {
  const res = await optout({ personId: 'nobody', duration: '7d' })
  expect(res.statusCode).toBe(400)
})

test('an unknown duration is rejected by schema', async () => {
  const res = await optout({ personId: PID, duration: '30d' })
  expect(res.statusCode).toBe(400)
})
