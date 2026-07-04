import { test, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, billingEvent } from '../src/db/schema.js'

const { pool, db } = openTestDb()

afterAll(async () => {
  await db.delete(billingEvent).where(eq(billingEvent.stripeEventId, 'evt_schema_test'))
  await db.delete(account).where(eq(account.id, 'ac_billing_schema'))
  await pool.end()
})

test('account billing columns and billing_event round-trip', async () => {
  await db.insert(account).values({
    id: 'ac_billing_schema', email: 'billing-schema@x.test',
    stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripeSubscriptionItemId: 'si_1',
    subscriptionStatus: 'active', trialEndsAt: new Date('2026-08-01T00:00:00Z'),
  })
  const [a] = await db.select().from(account).where(eq(account.id, 'ac_billing_schema'))
  expect(a.subscriptionStatus).toBe('active')
  expect(a.trialReminderSentAt).toBeNull()
  expect(a.trialEndsAt).toBeInstanceOf(Date)

  await db.insert(billingEvent).values({ stripeEventId: 'evt_schema_test', type: 'noop', summary: { ok: true } })
  const [e] = await db.select().from(billingEvent).where(eq(billingEvent.stripeEventId, 'evt_schema_test'))
  expect(e.type).toBe('noop')
  expect(e.accountId).toBeNull()
  // uniqueness = webhook idempotency backbone
  await expect(db.insert(billingEvent).values({ stripeEventId: 'evt_schema_test', type: 'noop' })).rejects.toThrow()
})
