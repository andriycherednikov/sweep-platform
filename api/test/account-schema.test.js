import { test, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, loginToken, accountSession, catalogLeague } from '../src/db/schema.js'

const { pool, db } = openTestDb()

afterAll(async () => {
  await db.delete(accountSession).where(eq(accountSession.token, 'sess1'))
  await db.delete(loginToken).where(eq(loginToken.token, 'tok1'))
  await db.delete(account).where(eq(account.id, 'ac_schema_test'))
  await db.delete(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  await pool.end()
})

test('the three new tables round-trip rows with defaults', async () => {
  await db.insert(loginToken).values({ token: 'tok1', email: 'a@b.c', expiresAt: new Date(Date.now() + 60_000) })
  const [lt] = await db.select().from(loginToken).where(eq(loginToken.token, 'tok1'))
  expect(lt.usedAt).toBeNull()
  expect(lt.createdAt).toBeInstanceOf(Date)

  await db.insert(account).values({ id: 'ac_schema_test', email: 'schema-test@x.y' })
  await db.insert(accountSession).values({ token: 'sess1', accountId: 'ac_schema_test', expiresAt: new Date(Date.now() + 60_000) })
  const [s] = await db.select().from(accountSession).where(eq(accountSession.token, 'sess1'))
  expect(s.accountId).toBe('ac_schema_test')

  await db.insert(catalogLeague).values({
    id: 'apifootball:39', provider: 'apifootball', providerLeagueId: '39', name: 'Premier League', type: 'League',
    country: { name: 'England', code: 'GB-ENG', flag: null },
    seasons: [{ season: '2025', start: '2025-08-15', end: '2026-05-24', current: false, standings: true, odds: false }],
  })
  const [cl] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  expect(cl.curated).toBe(false) // default
  expect(cl.seasons[0].standings).toBe(true)
  expect(cl.country.name).toBe('England')
})
