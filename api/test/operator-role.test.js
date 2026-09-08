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
