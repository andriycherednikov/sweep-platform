import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

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

test('GET /api/photos returns only approved; ?team filters', async () => {
  const all = (await app.inject({ method: 'GET', url: '/api/photos' })).json()
  expect(all.every((p) => p.status === 'approved')).toBe(true)
  const hr = (await app.inject({ method: 'GET', url: '/api/photos?team=hr' })).json()
  expect(hr.every((p) => p.team === 'hr')).toBe(true)
})
