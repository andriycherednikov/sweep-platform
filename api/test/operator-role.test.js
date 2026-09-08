import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account, operatorAction } from '../src/db/schema.js'
import { recordOperatorAction } from '../src/accounts/audit.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_op', email: 'op@example.test', role: 'operator', subscriptionStatus: 'active',
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

test('accounts are ordinary users unless made operators', async () => {
  const [seed] = await db.select().from(account).where(eq(account.id, 'ac_seed'))
  expect(seed.role).toBe('user')
})

test('an audit row records the actor and the sweeps an action touched', async () => {
  await recordOperatorAction(db, {
    actorId: 'ac_op', action: 'correct_fixture', target: 'fx_1', sweepIds: ['default'],
  })
  const [row] = await db.select().from(operatorAction).where(eq(operatorAction.target, 'fx_1'))
  expect(row.actorId).toBe('ac_op')
  expect(row.sweepIds).toEqual(['default'])
})

// A super route is requireOperator outright: an operator account session, or nothing.
const superApp = buildApp(db, { sessionSecret: 'test-secret' })
beforeAll(async () => { await superApp.ready() })
afterAll(async () => { await superApp.close() })

test('an operator account session reaches a super route with no cookie at all', async () => {
  const res = await superApp.inject({ method: 'GET', url: '/api/super/sweeps', headers: await ownerHeaders(db, 'ac_op') })
  expect(res.statusCode).toBe(200)
})

test('a signed-in non-operator account is 403 on a super route', async () => {
  const res = await superApp.inject({ method: 'GET', url: '/api/super/sweeps', headers: await ownerHeaders(db) })
  expect(res.statusCode).toBe(403)
})

test('no credentials at all is 401 on a super route', async () => {
  const res = await superApp.inject({ method: 'GET', url: '/api/super/sweeps' })
  expect(res.statusCode).toBe(401)
})

test('the passcode-era super session is gone, not merely unused', async () => {
  const res = await superApp.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'anything' } })
  expect(res.statusCode).toBe(404)
})
