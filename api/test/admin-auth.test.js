// api/test/admin-auth.test.js
import { expect, test, afterAll, beforeAll } from 'vitest'
import bcrypt from 'bcryptjs'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const PASS = '1234'
const app = buildApp(db, { adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 'test-secret-please-change' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/admin/me is 401 without a cookie', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/admin/me' })).statusCode).toBe(401)
})

test('login with the wrong passcode is 401, no cookie', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: 'oops' } })
  expect(res.statusCode).toBe(401)
  expect(res.headers['set-cookie']).toBeUndefined()
})

test('login → cookie → /api/admin/me is 200', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })
  expect(login.statusCode).toBe(200)
  const cookie = login.headers['set-cookie']
  expect(cookie).toMatch(/sweep_admin=/)
  expect(cookie).toMatch(/HttpOnly/i)
  const me = await app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } })
  expect(me.statusCode).toBe(200)
  expect(me.json()).toMatchObject({ admin: true })
})

test('logout clears the cookie', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })
  const cookie = login.headers['set-cookie']
  const out = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } })
  expect(out.statusCode).toBe(200)
})
