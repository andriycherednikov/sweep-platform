import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/bootstrap returns teams, people, ownership, scoring', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap' })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.teams).toHaveLength(48)
  expect(body.people).toHaveLength(16)
  expect(body.scoring.rule).toBe('top3')
  const andriy = body.people.find((p) => p.id === 'p4')
  expect(body.ownership[andriy.id]).toContain('hr')
})

test('bootstrap teams carry a squad field (null by default)', async () => {
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.teams.every((t) => 'squad' in t)).toBe(true)
  expect(body.teams[0].squad).toBeNull()
})
