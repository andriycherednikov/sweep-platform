import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/health returns ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
})
