import { expect, test, afterAll, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', superToken: 'super-xyz' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

async function superCookie() {
  const res = await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'super-xyz' } })
  return res.headers['set-cookie']
}

test('super session requires the right token', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'nope' } })).statusCode).toBe(401)
  expect((await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'super-xyz' } })).statusCode).toBe(200)
})

test('super can create a sweep and gets two tokens + links', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Acme' } })
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.name).toBe('Acme')
  expect(body.memberToken).toMatch(/^[0-9A-Za-z]{22}$/)
  expect(body.adminToken).toMatch(/^[0-9A-Za-z]{22}$/)
  expect(body.memberLink).toContain(`/g/${body.memberToken}`)
})

test('creating a sweep without a super cookie is 401', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/super/sweeps', payload: { name: 'X' } })).statusCode).toBe(401)
})

test('super can rotate a sweep member token (old token stops working)', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Rot' } })).json()
  const oldTok = created.memberToken
  const rot = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/rotate`, headers: { cookie }, payload: { which: 'member' } })
  expect(rot.statusCode).toBe(200)
  const newTok = rot.json().memberToken
  expect(newTok).not.toBe(oldTok)
  const old = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: oldTok } })
  expect(old.statusCode).toBe(404)
})
