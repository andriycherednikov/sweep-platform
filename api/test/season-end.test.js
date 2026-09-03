// A finished competition used to poll forever and bill forever: the worker's gate had no
// season-end predicate and billing counted every unarchived sweep. So a customer whose
// league ended in May kept paying $5/mo and kept burning feed quota until someone
// archived it by hand — a refund dispute and a cost leak out of the same missing idea.
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event, sweep, account } from '../src/db/schema.js'
import { endedCompetitionIds, GRACE_MS } from '../src/season.js'
import { activeCompetitions } from '../src/worker/active-competitions.js'
import { liveSweepCount } from '../src/accounts/billing.js'

const { pool, db } = openTestDb()
// seed.test.js counts every competitor and every event in the database, so anything this
// file leaves behind fails a test in another file. Clean up, don't just set up.
afterAll(async () => {
  await db.delete(event).where(inArray(event.competitionId, [COMP, 'apifootball:seasonend:2']))
  await db.delete(sweep).where(eq(sweep.id, SWEEP))
  await db.delete(competitor).where(inArray(competitor.competitionId, [COMP, 'apifootball:seasonend:2']))
  await db.delete(competition).where(inArray(competition.id, [COMP, 'apifootball:seasonend:2']))
  await db.delete(account).where(eq(account.id, ACCT))
  await pool.end()
})

const COMP = 'apifootball:seasonend:1'
const SWEEP = 'sw_seasonend'
const ACCT = 'ac_seasonend'
const ago = (ms) => new Date(Date.now() - ms)

beforeEach(async () => {
  await db.delete(event).where(eq(event.competitionId, COMP))
  await db.delete(sweep).where(eq(sweep.id, SWEEP))
  await db.delete(competitor).where(eq(competitor.competitionId, COMP))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(account).where(eq(account.id, ACCT))
  await db.insert(competition).values({
    id: COMP, provider: 'apifootball', sport: 'football',
    leagueId: 'seasonend', season: '1', format: 'league', name: 'Season End FC',
  })
  await db.insert(competitor).values([
    { id: 'cp_se_ar', competitionId: COMP, code: 'ar', name: 'Argentina', color: '#75AADB' },
    { id: 'cp_se_pl', competitionId: COMP, code: 'pl', name: 'Poland', color: '#DC143C' },
  ])
  await db.insert(account).values({ id: ACCT, email: 'seasonend@test.invalid', subscriptionStatus: 'active' })
  await db.insert(sweep).values({
    id: SWEEP, name: 'Season End', kind: 'token', memberToken: 'm_seasonend',
    adminToken: 'a_seasonend', competitionId: COMP, accountId: ACCT,
  })
})

const fixture = (id, status, startUtc) => ({
  id, competitionId: COMP, c1Code: 'ar', c2Code: 'pl', startUtc, status,
})

test('a competition whose fixtures are all played and long past has ended', async () => {
  await db.insert(event).values([
    fixture('se1', 'final', ago(GRACE_MS + 40 * 86400_000)),
    fixture('se2', 'final', ago(GRACE_MS + 86400_000)),
  ])
  expect(await endedCompetitionIds(db)).toContain(COMP)
})

test('one unplayed fixture keeps the season open, however old the rest are', async () => {
  await db.insert(event).values([
    fixture('se1', 'final', ago(GRACE_MS + 40 * 86400_000)),
    fixture('se2', 'upcoming', ago(GRACE_MS + 86400_000)), // postponed, never played
  ])
  expect(await endedCompetitionIds(db)).not.toContain(COMP)
})

test('the grace window keeps a just-finished season open, so a late fixture can still arrive', async () => {
  await db.insert(event).values([fixture('se1', 'final', ago(86400_000))]) // yesterday
  expect(await endedCompetitionIds(db)).not.toContain(COMP)
})

test('a competition with no fixtures yet has not ended — it has not started', async () => {
  // provisioned seconds ago, the feed fill still in flight: an empty fixture list must
  // never read as "over", or a brand new sweep would stop syncing before it ever synced
  expect(await endedCompetitionIds(db)).not.toContain(COMP)
})

test('the worker stops polling a competition whose season is over', async () => {
  await db.insert(event).values([fixture('se1', 'final', ago(GRACE_MS + 40 * 86400_000))])
  const ids = (await activeCompetitions(db)).map((c) => c.id)
  expect(ids).not.toContain(COMP)
})

test('the worker keeps polling while a fixture is still to be played', async () => {
  await db.insert(event).values([fixture('se1', 'upcoming', new Date(Date.now() + 86400_000))])
  expect((await activeCompetitions(db)).map((c) => c.id)).toContain(COMP)
})

test('a finished season stops counting toward the bill, without being archived', async () => {
  await db.insert(event).values([fixture('se1', 'final', ago(GRACE_MS + 40 * 86400_000))])
  expect(await liveSweepCount(db, ACCT)).toBe(0)
  const [row] = await db.select().from(sweep).where(eq(sweep.id, SWEEP))
  expect(row.archivedAt).toBeNull() // still theirs, still visible — just not billed
})

test('a running season still counts toward the bill', async () => {
  await db.insert(event).values([fixture('se1', 'upcoming', new Date(Date.now() + 86400_000))])
  expect(await liveSweepCount(db, ACCT)).toBe(1)
})

test('ended competitions are found in one query, not one per competition', async () => {
  const OTHER = 'apifootball:seasonend:2'
  await db.delete(event).where(inArray(event.competitionId, [OTHER]))
  await db.delete(competitor).where(eq(competitor.competitionId, OTHER))
  await db.delete(competition).where(eq(competition.id, OTHER))
  await db.insert(competition).values({
    id: OTHER, provider: 'apifootball', sport: 'football',
    leagueId: 'seasonend', season: '2', format: 'league', name: 'Other FC',
  })
  await db.insert(competitor).values([
    { id: 'cp_o_ar', competitionId: OTHER, code: 'ar', name: 'Argentina', color: '#75AADB' },
    { id: 'cp_o_pl', competitionId: OTHER, code: 'pl', name: 'Poland', color: '#DC143C' },
  ])
  await db.insert(event).values([
    fixture('se1', 'final', ago(GRACE_MS + 40 * 86400_000)),
    { id: 'se9', competitionId: OTHER, c1Code: 'ar', c2Code: 'pl', startUtc: ago(GRACE_MS + 86400_000), status: 'final' },
  ])
  const ended = await endedCompetitionIds(db)
  expect(ended).toEqual(expect.arrayContaining([COMP, OTHER]))
  await db.delete(event).where(eq(event.competitionId, OTHER))
  await db.delete(competitor).where(eq(competitor.competitionId, OTHER))
  await db.delete(competition).where(eq(competition.id, OTHER))
})

// syncQuantity only runs when a sweep is added or archived. A season ending is neither,
// so without a daily re-assert Stripe never hears about it and the customer keeps paying.
test('the daily pass re-asserts the quantity against what is actually running', async () => {
  const { fakeStripe } = await import('./helpers/fake-stripe.js')
  const { reassertQuantities } = await import('../src/accounts/billing.js')
  await db.update(account)
    .set({ stripeSubscriptionId: 'sub_se', stripeSubscriptionItemId: 'si_se' })
    .where(eq(account.id, ACCT))
  await db.insert(event).values([fixture('se1', 'upcoming', new Date(Date.now() + 86400_000))])

  const stripe = fakeStripe()
  await reassertQuantities(db, stripe)
  expect(stripe.calls.subUpdate.find((c) => c.id === 'sub_se').items[0].quantity).toBe(1)

  // the season ends: the sweep is still theirs, but it stops being billed for
  await db.update(event).set({ status: 'final', startUtc: ago(GRACE_MS + 86400_000) }).where(eq(event.id, 'se1'))
  const after = fakeStripe()
  const out = await reassertQuantities(db, after)
  // floored at 1 — dropping to 0 means cancelling somebody's subscription unasked, which
  // this loop does not decide on its own; it reports them instead
  expect(after.calls.subUpdate.find((c) => c.id === 'sub_se').items[0].quantity).toBe(1)
  expect(out.payingForNothing).toContain(ACCT)
})

test('with no Stripe configured the daily pass is a no-op rather than a crash', async () => {
  const { reassertQuantities } = await import('../src/accounts/billing.js')
  expect(await reassertQuantities(db, null)).toEqual({ updated: 0, payingForNothing: [] })
})
