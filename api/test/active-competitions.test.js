import { test, expect, beforeAll, afterAll } from 'vitest'
import { inArray, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, competition, sweep } from '../src/db/schema.js'
import { activeCompetitions } from '../src/worker/active-competitions.js'

const { pool, db } = openTestDb()
const NOW = new Date('2026-07-04T12:00:00Z')
const COMPS = ['apibasketball:12:ac-ops', 'apibasketball:12:ac-trial', 'apibasketball:12:ac-lapsed', 'apibasketball:12:ac-shared']
const comp = (season) => ({ id: `apibasketball:12:${season}`, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season, format: 'league', name: season })

beforeAll(async () => {
  await db.insert(competition).values(COMPS.map((id) => comp(id.split(':')[2]))).onConflictDoNothing()
  await db.insert(account).values([
    { id: 'ac_ac_trial', email: 'ac-trial@x.test', trialEndsAt: new Date(NOW.getTime() + 86400_000) },
    { id: 'ac_ac_lapsed', email: 'ac-lapsed@x.test', subscriptionStatus: 'canceled' },
    { id: 'ac_ac_paid', email: 'ac-paid@x.test', subscriptionStatus: 'active' },
  ])
  await db.insert(sweep).values([
    { id: 'sw_ac_ops', name: 'ops', kind: 'token', memberToken: 'acm1', adminToken: 'aca1', competitionId: COMPS[0], accountId: null },
    { id: 'sw_ac_trial', name: 'trial', kind: 'token', memberToken: 'acm2', adminToken: 'aca2', competitionId: COMPS[1], accountId: 'ac_ac_trial' },
    { id: 'sw_ac_lapsed', name: 'lapsed', kind: 'token', memberToken: 'acm3', adminToken: 'aca3', competitionId: COMPS[2], accountId: 'ac_ac_lapsed' },
    // shared competition: one lapsed + one paid sweep → competition must STAY
    { id: 'sw_ac_shared_l', name: 'shared-l', kind: 'token', memberToken: 'acm4', adminToken: 'aca4', competitionId: COMPS[3], accountId: 'ac_ac_lapsed' },
    { id: 'sw_ac_shared_p', name: 'shared-p', kind: 'token', memberToken: 'acm5', adminToken: 'aca5', competitionId: COMPS[3], accountId: 'ac_ac_paid' },
  ])
})
afterAll(async () => {
  await db.delete(sweep).where(inArray(sweep.competitionId, COMPS))
  await db.delete(competition).where(inArray(competition.id, COMPS))
  await db.delete(account).where(inArray(account.id, ['ac_ac_trial', 'ac_ac_lapsed', 'ac_ac_paid']))
  await pool.end()
})

test('lapsed sweeps drop their competition unless a live sweep shares it; ops + trial stay', async () => {
  const ids = (await activeCompetitions(db, NOW)).map((c) => c.id).filter((id) => COMPS.includes(id)).sort()
  expect(ids).toEqual(['apibasketball:12:ac-ops', 'apibasketball:12:ac-shared', 'apibasketball:12:ac-trial'].sort())
})

test('trial expiry flips the competition out with no state write', async () => {
  const later = new Date(NOW.getTime() + 3 * 86400_000)
  await db.update(account).set({ trialEndsAt: new Date(NOW.getTime() + 86400_000) }).where(eq(account.id, 'ac_ac_trial'))
  const ids = (await activeCompetitions(db, later)).map((c) => c.id)
  expect(ids).not.toContain('apibasketball:12:ac-trial')
})
