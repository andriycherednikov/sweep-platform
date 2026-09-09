import { eq } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { providerFor } from '../providers/registry.js'
import { syncCompetitors } from './sync-competitors.js'
import { competition } from '../db/schema.js'

// Refresh a competition's roster from the feed — names, crests and conference.
// The periodic worker only does this for sports whose provider drops unknown teams;
// football is deliberately CLI-driven (worker.js:31), which left no way at all to pull
// a crest that arrived after the competition was provisioned.
//
//   npm run competitors:sync -w api -- <competitionId>     one competition
//   npm run competitors:sync -w api                        all of them
const only = process.argv[2] ?? null
const pool = createPool()
const db = createDb(pool)
try {
  const comps = only
    ? await db.select().from(competition).where(eq(competition.id, only))
    : await db.select().from(competition)
  if (!comps.length) { console.error(only ? `no competition ${only}` : 'no competitions'); process.exit(1) }
  for (const comp of comps) {
    try {
      const r = await syncCompetitors(db, providerFor(comp), comp)
      console.log(`${comp.id}: ${JSON.stringify(r)}`)
    } catch (e) {
      console.error(`${comp.id} FAILED (last-good data left intact): ${e.message}`)
      process.exitCode = 1
    }
  }
} finally {
  await pool.end()
}
