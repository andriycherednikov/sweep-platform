import { and, eq } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { catalogLeague } from '../db/schema.js'

/** Flip a league's curated flag. Returns updated row count (0 = league not in catalog). */
export async function setCurated(db, providerKey, leagueId, on) {
  const rows = await db.update(catalogLeague).set({ curated: on })
    .where(and(eq(catalogLeague.provider, providerKey), eq(catalogLeague.providerLeagueId, String(leagueId))))
    .returning({ id: catalogLeague.id })
  return rows.length
}

// CLI: npm run catalog:curate -w api -- <provider> <leagueId> [--off]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [providerKey, leagueId, flag] = process.argv.slice(2)
  if (!providerKey || !leagueId) {
    console.error('usage: npm run catalog:curate -w api -- <apifootball|apibasketball> <leagueId> [--off]')
    process.exit(1)
  }
  const pool = createPool()
  const db = createDb(pool)
  try {
    const on = flag !== '--off'
    const n = await setCurated(db, providerKey, leagueId, on)
    if (!n) { console.error(`league ${providerKey}:${leagueId} not in catalog — run catalog:sync first`); process.exitCode = 1 }
    else console.log(`${providerKey}:${leagueId} curated=${on}`)
  } finally {
    await pool.end()
  }
}
