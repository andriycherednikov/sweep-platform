import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk } from '../src/db/schema.js'
import { resolveCrosswalk, assertResolved } from '../src/worker/crosswalk.js'
import { matchTeams } from '../src/worker/crosswalk-sync.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

// reset provider ids before each test so we don't depend on order
beforeEach(async () => { await db.update(teamCrosswalk).set({ providerTeamId: null }) })

test('matchTeams maps provider teams to our codes by name/country', () => {
  const ours = [{ code: 'hr', name: 'Croatia' }, { code: 'be', name: 'Belgium' }, { code: 'gh', name: 'Ghana' }]
  const provider = [
    { providerTeamId: 3001, name: 'Croatia', country: 'Croatia' },
    { providerTeamId: 3002, name: 'Belgium', country: 'Belgium' },
    { providerTeamId: 4040, name: 'Nowhere', country: 'Nowhere' },
  ]
  const { matched, unmatchedProvider, unmatchedOurs } = matchTeams(ours, provider)
  expect(matched).toEqual(expect.arrayContaining([
    { teamCode: 'hr', providerTeamId: 3001 }, { teamCode: 'be', providerTeamId: 3002 },
  ]))
  expect(unmatchedOurs.map((t) => t.code)).toContain('gh')
  expect(unmatchedProvider.map((t) => t.providerTeamId)).toContain(4040)
})

test('resolveCrosswalk returns a providerId→code map for filled rows only', async () => {
  await db.update(teamCrosswalk).set({ providerTeamId: 3001 }).where(eq(teamCrosswalk.teamCode, 'hr'))
  const map = await resolveCrosswalk(db)
  expect(map.get(3001)).toBe('hr')
  expect(map.size).toBe(1)
})

test('assertResolved throws loudly listing unresolved provider ids', async () => {
  await db.update(teamCrosswalk).set({ providerTeamId: 3001 }).where(eq(teamCrosswalk.teamCode, 'hr'))
  const map = await resolveCrosswalk(db)
  expect(() => assertResolved(map, [3001, 3002])).toThrow(/3002/)
  expect(() => assertResolved(map, [3001])).not.toThrow()
})
