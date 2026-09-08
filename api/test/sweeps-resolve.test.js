import { expect, test, afterAll, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { newToken } from '../src/sweeps/tokens.js'
import { sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })
const TOK = newToken()
beforeAll(async () => {
  await app.ready()
  await db.insert(sweep).values({ id: 'sw_resolve', name: 'R', kind: 'token', memberToken: TOK, adminToken: newToken(), competitionId: 'apifootball:1:2026' })
})
afterAll(async () => { await app.close(); await pool.end() })

test('no session cookie is no sweep — there is nothing to fall back into', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/whoami' })
  expect(res.json()).toEqual({ sweepId: null, role: null })
})
