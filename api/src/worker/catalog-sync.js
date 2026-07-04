import { createPool, createDb } from '../db/client.js'
import { providerFor, PROVIDER_KEYS } from '../providers/registry.js'
import { catalogLeague, syncLog } from '../db/schema.js'

/** Upsert the provider's full /leagues catalog. NEVER touches `curated` (operator data). */
export async function syncCatalog(db, providerKey, provider) {
  try {
    const leagues = await provider.fetchCompetitions()
    for (const l of leagues) {
      const row = {
        id: `${providerKey}:${l.providerLeagueId}`, provider: providerKey, providerLeagueId: String(l.providerLeagueId),
        name: l.name, type: l.type, logo: l.logo, country: l.country, seasons: l.seasons, updatedAt: new Date(),
      }
      await db.insert(catalogLeague).values(row).onConflictDoUpdate({
        target: catalogLeague.id,
        set: { name: row.name, type: row.type, logo: row.logo, country: row.country, seasons: row.seasons, updatedAt: row.updatedAt },
      })
    }
    await db.insert(syncLog).values({ source: providerKey, kind: 'catalog', status: 'ok', counts: { leagues: leagues.length } })
    return { leagues: leagues.length }
  } catch (err) {
    await db.insert(syncLog).values({ source: providerKey, kind: 'catalog', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}

// CLI: npm run catalog:sync -w api   (~1 request per provider)
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  const db = createDb(pool)
  try {
    for (const key of PROVIDER_KEYS) {
      const r = await syncCatalog(db, key, providerFor({ provider: key }))
      console.log(`catalog ${key}: ${r.leagues} leagues`)
    }
  } catch (e) {
    console.error('catalog:sync FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
