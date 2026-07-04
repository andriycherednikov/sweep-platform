import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { catalogLeague, syncLog } from '../src/db/schema.js'
import { syncCatalog } from '../src/worker/catalog-sync.js'
import { setCurated } from '../src/worker/catalog-curate.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))

afterAll(async () => {
  await db.delete(catalogLeague).where(eq(catalogLeague.provider, 'apifootball'))
  await pool.end()
})

test('syncCatalog upserts leagues, preserves curated across re-syncs, keeps gone leagues', async () => {
  const provider = createRecordedProvider({ leagues: load('leagues') }) // WC (1) + EPL (39)
  const r1 = await syncCatalog(db, 'apifootball', provider)
  expect(r1.leagues).toBe(2)
  const [epl] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  expect(epl).toMatchObject({ provider: 'apifootball', providerLeagueId: '39', name: 'Premier League', type: 'League', curated: false })
  expect(epl.country.name).toBe('England')
  expect(epl.seasons.find((s) => s.season === '2025').standings).toBe(true)

  // curate, then re-sync with a feed that renamed the league AND dropped the WC
  expect(await setCurated(db, 'apifootball', '39', true)).toBe(1)
  const renamed = structuredClone(load('leagues'))
  renamed.response = renamed.response.filter((r) => r.league.id === 39)
  renamed.response[0].league.name = 'The Prem'
  await syncCatalog(db, 'apifootball', createRecordedProvider({ leagues: renamed }))
  const [epl2] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  expect(epl2.name).toBe('The Prem')   // updated
  expect(epl2.curated).toBe(true)      // survived the re-sync
  const [wc] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:1'))
  expect(wc).toBeDefined()             // gone from the feed → kept
  expect(await setCurated(db, 'apifootball', '9999', true)).toBe(0) // unknown league → 0
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'catalog'))
  expect(logs.at(-1).status).toBe('ok')
})
