import { test, expect, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, sweep, competition } from '../src/db/schema.js'
import { sweepIsLive, liveSweepCount, syncQuantity, TRIAL_MS, GOOD_STANDING } from '../src/accounts/billing.js'

const { pool, db } = openTestDb()
const NOW = new Date('2026-07-04T12:00:00Z')
const past = new Date(NOW.getTime() - 1000)
const future = new Date(NOW.getTime() + 1000)

afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_live'))
  await db.delete(competition).where(eq(competition.id, 'apibasketball:12:liveness'))
  await db.delete(account).where(eq(account.id, 'ac_live'))
  await pool.end()
})

test('sweepIsLive: ops sweeps always; trial/paid/lapse matrix', () => {
  const s = { archivedAt: null, accountId: 'ac_x' }
  expect(sweepIsLive({ ...s, accountId: null }, null, NOW)).toBe(true)              // ops sweep
  expect(sweepIsLive({ ...s, archivedAt: past, accountId: null }, null, NOW)).toBe(false) // archived beats everything
  expect(sweepIsLive(s, { subscriptionStatus: 'active' }, NOW)).toBe(true)
  expect(sweepIsLive(s, { subscriptionStatus: 'past_due' }, NOW)).toBe(true)        // dunning grace
  expect(sweepIsLive(s, { subscriptionStatus: 'unpaid' }, NOW)).toBe(false)
  expect(sweepIsLive(s, { subscriptionStatus: 'canceled', trialEndsAt: future }, NOW)).toBe(false) // trial is pre-card only
  expect(sweepIsLive(s, { subscriptionStatus: null, trialEndsAt: future }, NOW)).toBe(true)  // in trial
  expect(sweepIsLive(s, { subscriptionStatus: null, trialEndsAt: past }, NOW)).toBe(false)   // trial expired
  expect(sweepIsLive(s, { subscriptionStatus: null, trialEndsAt: null }, NOW)).toBe(false)   // no clock, never subscribed
  expect(sweepIsLive(s, null, NOW)).toBe(false)                                     // orphaned accountId
  expect(TRIAL_MS).toBe(14 * 24 * 3600_000)
  expect(GOOD_STANDING).toEqual(['active', 'past_due'])
})

test('liveSweepCount counts unarchived sweeps; syncQuantity no-ops without subscription ids', async () => {
  await db.insert(account).values({ id: 'ac_live', email: 'live@x.test' })
  await db.insert(competition).values({ id: 'apibasketball:12:liveness', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'liveness', format: 'league', name: 'L' }).onConflictDoNothing()
  await db.insert(sweep).values([
    { id: 'sw_live_1', name: 'A', kind: 'token', memberToken: 'lm1', adminToken: 'la1', competitionId: 'apibasketball:12:liveness', accountId: 'ac_live' },
    { id: 'sw_live_2', name: 'B', kind: 'token', memberToken: 'lm2', adminToken: 'la2', competitionId: 'apibasketball:12:liveness', accountId: 'ac_live', archivedAt: past },
  ])
  expect(await liveSweepCount(db, 'ac_live')).toBe(1)

  const calls = []
  const stripe = { subscriptions: { update: async (id, p) => calls.push({ id, ...p }) } }
  await syncQuantity(stripe, { stripeSubscriptionId: null, stripeSubscriptionItemId: null }, 3)
  expect(calls).toHaveLength(0) // never subscribed → nothing to sync
  await syncQuantity(stripe, { stripeSubscriptionId: 'sub_9', stripeSubscriptionItemId: 'si_9' }, 3)
  expect(calls).toEqual([{ id: 'sub_9', items: [{ id: 'si_9', quantity: 3 }], proration_behavior: 'none' }])
})

test('sendTrialReminders mails once, only near-expiry unsubscribed accounts', async () => {
  const NOW2 = new Date('2026-07-10T12:00:00Z')
  const in2d = new Date(NOW2.getTime() + 2 * 86400_000)
  const in10d = new Date(NOW2.getTime() + 10 * 86400_000)
  await db.insert(account).values([
    { id: 'ac_rem_due', email: 'rem-due@x.test', trialEndsAt: in2d },
    { id: 'ac_rem_far', email: 'rem-far@x.test', trialEndsAt: in10d },
    { id: 'ac_rem_paid', email: 'rem-paid@x.test', trialEndsAt: in2d, subscriptionStatus: 'active' },
    { id: 'ac_rem_over', email: 'rem-over@x.test', trialEndsAt: new Date(NOW2.getTime() - 1000) },
  ])
  const mails = []
  const { sendTrialReminders } = await import('../src/accounts/billing.js')
  expect(await sendTrialReminders(db, async (to, subject) => mails.push({ to, subject }), NOW2)).toBe(1)
  expect(mails).toEqual([{ to: 'rem-due@x.test', subject: expect.stringMatching(/trial/i) }])
  expect(await sendTrialReminders(db, async (to) => mails.push(to), NOW2)).toBe(0) // once, ever
  await db.delete(account).where(inArray(account.id, ['ac_rem_due', 'ac_rem_far', 'ac_rem_paid', 'ac_rem_over']))
})
