import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account, operatorAction } from '../src/db/schema.js'
import { recordOperatorAction } from '../src/accounts/audit.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
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

// requireSuper is transitional: the legacy super cookie OR an operator account session.
// The cookie half is deleted in Task 10, at which point a super route is requireOperator
// outright — these four cases are exactly the semantics that guard settles into.
const superApp = buildApp(db, { sessionSecret: 'test-secret', superToken: 'super-bridge-test' })
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

test('the legacy super cookie still works — every unmigrated call site stays green', async () => {
  const login = await superApp.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'super-bridge-test' } })
  const cookie = login.headers['set-cookie']
  const res = await superApp.inject({ method: 'GET', url: '/api/super/sweeps', headers: { cookie } })
  expect(res.statusCode).toBe(200)
})
