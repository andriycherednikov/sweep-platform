import { expect, test, afterAll, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

test('no session cookie is no sweep — there is nothing to fall back into', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/whoami' })
  expect(res.json()).toEqual({ sweepId: null, role: null })
})
