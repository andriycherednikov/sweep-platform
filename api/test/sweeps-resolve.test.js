import { expect, test, afterAll, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { newToken } from '../src/sweeps/tokens.js'
import { sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
const TOK = newToken()
beforeAll(async () => {
  await app.ready()
  await db.insert(sweep).values({ id: 'sw_resolve', name: 'R', kind: 'token', memberToken: TOK, adminToken: newToken() })
})
afterAll(async () => { await app.close(); await pool.end() })

test('non-platform host resolves the default sweep as member', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/whoami' }) // host defaults to localhost
  expect(res.json()).toEqual({ sweepId: 'default', role: 'member' })
})

test('platform host with no session cookie has no sweep', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/whoami', headers: { host: 'platform.test' } })
  expect(res.json()).toEqual({ sweepId: null, role: null })
})
