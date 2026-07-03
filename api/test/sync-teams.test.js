import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event } from '../src/db/schema.js'
import { syncTeams } from '../src/worker/sync-teams.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const TT = 'apifootball:998:sync-teams-test'

afterAll(async () => {
  await db.delete(event).where(eq(event.competitionId, TT))
  await db.delete(competitor).where(eq(competitor.competitionId, TT))
  await db.delete(competition).where(eq(competition.id, TT))
  await pool.end()
})

test('syncTeams keeps a to-be-deleted competitor that has historical events', async () => {
  await db.insert(competition).values({ id: TT, provider: 'apifootball', sport: 'football', leagueId: '998', season: '2026', format: 'groups_then_ko', name: 'ST Test' }).onConflictDoNothing()
  // two teams absent from the recorded feed: one with history, one without
  await db.insert(competitor).values([
    { id: `cp_${TT}_xx`, competitionId: TT, code: 'xx', name: 'Xx Gone FC', color: '#111' },
    { id: `cp_${TT}_yy`, competitionId: TT, code: 'yy', name: 'Yy Gone FC', color: '#222' },
  ]).onConflictDoNothing()
  await db.insert(event).values({
    id: 'ev_st_fk', competitionId: TT, c1Code: 'xx', c2Code: 'yy',
    startUtc: new Date(), status: 'final', score1: 1, score2: 0, winnerCode: 'xx', stage: 'group', detail: {},
  }).onConflictDoNothing()
  const provider = createRecordedProvider({ teams: load('teams'), standings: load('standings') })
  await syncTeams(db, provider, { season: '2026', competitionId: TT }) // must not FK-crash
  const codes = (await db.select().from(competitor).where(eq(competitor.competitionId, TT))).map((c) => c.code)
  expect(codes).toContain('xx') // history preserved
  expect(codes).toContain('yy') // referenced by xx's event as c2
})
