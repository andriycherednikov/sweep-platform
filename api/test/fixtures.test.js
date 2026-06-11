import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/fixtures returns all fixtures ordered by kickoff', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fixtures' })
  expect(res.statusCode).toBe(200)
  const list = res.json()
  expect(list).toHaveLength(72)
  const kos = list.map((f) => new Date(f.ko).getTime())
  expect(kos).toEqual([...kos].sort((a, b) => a - b))
})

test('GET /api/fixtures?team=hr returns only Croatia matches', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fixtures?team=hr' })
  const list = res.json()
  expect(list.length).toBeGreaterThan(0)
  expect(list.every((f) => f.t1 === 'hr' || f.t2 === 'hr')).toBe(true)
})

test('GET /api/fixtures?person=p4 returns Andriy\'s teams\' matches', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fixtures?person=p4' })
  const list = res.json()
  expect(list.every((f) => ['fr', 'hr'].includes(f.t1) || ['fr', 'hr'].includes(f.t2))).toBe(true)
})

test('fixtures carry a lineups field (null by default)', async () => {
  const list = (await app.inject({ method: 'GET', url: '/api/fixtures' })).json()
  expect(list.every((f) => 'lineups' in f)).toBe(true)
  expect(list[0].lineups).toBeNull()
})

test('GET /api/fixtures/:id returns one fixture or 404', async () => {
  const all = (await app.inject({ method: 'GET', url: '/api/fixtures' })).json()
  const one = await app.inject({ method: 'GET', url: `/api/fixtures/${all[0].id}` })
  expect(one.statusCode).toBe(200)
  expect(one.json().id).toBe(all[0].id)
  const missing = await app.inject({ method: 'GET', url: '/api/fixtures/nope' })
  expect(missing.statusCode).toBe(404)
})
