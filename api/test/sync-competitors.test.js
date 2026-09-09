import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event } from '../src/db/schema.js'
import { syncCompetitors, slugName } from '../src/worker/sync-competitors.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
// a season of its own: the provision suites fill 'apibasketball:12:2023-2024' in the
// background now, and sharing an id with them made this suite's counts a race
const NBA = { id: 'apibasketball:12:2023-2024-synctest', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024-synctest' }

afterAll(async () => {
  await db.delete(event).where(eq(event.competitionId, NBA.id))
  await db.delete(competitor).where(eq(competitor.competitionId, NBA.id))
  await db.delete(competition).where(eq(competition.id, NBA.id))
  await pool.end()
})

test('slugName produces stable url/wire-safe codes', () => {
  expect(slugName('Oklahoma City Thunder')).toBe('oklahoma-city-thunder')
  expect(slugName('Portland Trail Blazers')).toBe('portland-trail-blazers')
})

test('syncCompetitors inserts the 30 franchises with conference meta, then deletes leavers', async () => {
  await db.insert(competition).values({ ...NBA, format: 'league', name: 'NBA' }).onConflictDoNothing()
  const provider = createRecordedBasketballProvider({ teams: load('teams'), standings: load('standings') })
  const r1 = await syncCompetitors(db, provider, NBA)
  expect(r1).toMatchObject({ inserted: 30, deleted: 0 })
  const rows = await db.select().from(competitor).where(eq(competitor.competitionId, NBA.id))
  expect(rows).toHaveLength(30)
  const okc = rows.find((c) => c.code === 'oklahoma-city-thunder')
  expect(okc.providerId).toBe(152)
  expect(okc.meta.conference).toBe('Western Conference')
  expect(okc.meta.group).toBe('Western Conference')
  expect(okc.color).toMatch(/^hsl\(/)
  expect(okc.logo).toMatch(/^https:/)

  // second run: idempotent updates, no dupes
  const r2 = await syncCompetitors(db, provider, NBA)
  expect(r2).toMatchObject({ inserted: 0, updated: 30, deleted: 0 })

  // a team leaving the feed is deleted
  const teams31 = structuredClone(load('teams'))
  teams31.response = teams31.response.filter((t) => t.id !== 152)
  const r3 = await syncCompetitors(db, createRecordedBasketballProvider({ teams: teams31, standings: load('standings') }), NBA)
  expect(r3.deleted).toBe(1)
  expect(await db.select().from(competitor).where(eq(competitor.competitionId, NBA.id))).toHaveLength(29)
})

test('a leaver with historical events is kept (loud skip), not an FK crash', async () => {
  // restore the full 30 (OKC was deleted above), then pin OKC into history via an event
  const provider = createRecordedBasketballProvider({ teams: load('teams'), standings: load('standings') })
  await syncCompetitors(db, provider, NBA)
  await db.insert(event).values({
    id: 'ev_sc_fk', competitionId: NBA.id, c1Code: 'oklahoma-city-thunder', c2Code: 'minnesota-timberwolves',
    startUtc: new Date(), status: 'final', score1: 100, score2: 90, winnerCode: 'oklahoma-city-thunder', stage: 'group', detail: {},
  }).onConflictDoNothing()
  const teams31 = structuredClone(load('teams'))
  teams31.response = teams31.response.filter((t) => t.id !== 152) // OKC leaves the feed
  const r = await syncCompetitors(db, createRecordedBasketballProvider({ teams: teams31, standings: load('standings') }), NBA)
  expect(r.deleted).toBe(0)
  const rows = await db.select().from(competitor).where(eq(competitor.competitionId, NBA.id))
  expect(rows.map((c) => c.code)).toContain('oklahoma-city-thunder') // history preserved
})

// Matching is by providerId, so a curated roster matches nothing and every team lands a
// SECOND time under a slug code — 48 countries became 96 when this was tried for real.
// The seeded half keeps all the ownership, so the duplicate set is invisible until the
// roster page shows everyone twice.
test('syncCompetitors refuses a curated roster rather than duplicating it', async () => {
  const CURATED = { ...NBA, id: `${NBA.id}-curated`, season: `${NBA.season}-curated` }
  await db.insert(competition).values({ ...CURATED, format: 'league', name: 'NBA curated' }).onConflictDoNothing()
  await db.insert(competitor).values({
    id: `cp_${CURATED.id}_hr`, competitionId: CURATED.id, code: 'hr', name: 'Croatia',
    color: '#c00', providerId: null,
  })
  const provider = createRecordedBasketballProvider({ teams: load('teams'), standings: load('standings') })
  try {
    await expect(syncCompetitors(db, provider, CURATED)).rejects.toThrow(/curated, not feed-born/)
    const rows = await db.select().from(competitor).where(eq(competitor.competitionId, CURATED.id))
    expect(rows).toHaveLength(1) // untouched, not 31
  } finally {
    await db.delete(competitor).where(eq(competitor.competitionId, CURATED.id))
    await db.delete(competition).where(eq(competition.id, CURATED.id))
  }
})
