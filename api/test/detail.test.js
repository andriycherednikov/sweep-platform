import { expect, test, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, event } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/people returns 16 with their teams', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/people' })
  expect(res.statusCode).toBe(200)
  const people = res.json()
  expect(people).toHaveLength(16)
  expect(people.find((p) => p.id === 'p4').teams).toEqual(expect.arrayContaining(['fr', 'hr']))
})

test('GET /api/teams/hr returns Croatia with owners', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/teams/hr' })
  expect(res.statusCode).toBe(200)
  const t = res.json()
  expect(t.name).toBe('Croatia')
  expect(t.owners.map((o) => o.id)).toContain('p4')
  const missing = await app.inject({ method: 'GET', url: '/api/teams/zz' })
  expect(missing.statusCode).toBe(404)
})

test('GET /api/photos returns only approved, tagged with a fixtureId; ?fixture filters', async () => {
  // self-contained: tag a known fixture so we don't depend on shared seed state
  const [f] = await db.select().from(event).limit(1)
  await db.insert(photo).values({ id: 'detail-ph', sweepId: 'default', kind: 'fan', uploaderName: 'T', fixtureId: f.id, filePath: 'x.jpg', status: 'approved' }).onConflictDoNothing()
  try {
    const all = (await app.inject({ method: 'GET', url: '/api/photos' })).json()
    expect(all.every((p) => p.status === 'approved')).toBe(true)
    expect(all.find((p) => p.id === 'detail-ph')?.fixtureId).toBe(f.id)
    const one = (await app.inject({ method: 'GET', url: `/api/photos?fixture=${f.id}` })).json()
    expect(one.length).toBeGreaterThan(0)
    expect(one.every((p) => p.fixtureId === f.id)).toBe(true)
  } finally {
    await db.delete(photo).where(eq(photo.id, 'detail-ph'))
  }
})
