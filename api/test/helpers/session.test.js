import { expect, test, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.js'
import { openTestDb } from './db.js'
import { memberCookie, ownerHeaders } from './session.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

test('memberCookie resolves the seeded sweep as a member', async () => {
  const res = await app.inject({
    method: 'GET', url: '/api/whoami',
    headers: { host: 'platform.test', cookie: await memberCookie(app) },
  })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'member' })
})

test('ownerHeaders mints a usable account session', async () => {
  const res = await app.inject({
    method: 'GET', url: '/api/account',
    headers: await ownerHeaders(db),
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().id).toBe('ac_seed')
})
