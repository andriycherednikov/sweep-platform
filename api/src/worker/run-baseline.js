import { asc } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { providerFor } from '../providers/registry.js'
import { syncBaseline } from './baseline-sync.js'
import { competition } from '../db/schema.js'

const pool = createPool()
const db = createDb(pool)
try {
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [comp] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  if (!comp) { console.error('no competition found — run competition:add or db:seed first'); process.exit(1) }
  const r = await syncBaseline(db, providerFor(comp), comp)
  console.log(`baseline sync ok: ${r.fixtures} fixtures, ${r.standings} standings, ${r.newlyFinal.length} newly final`)
} catch (e) {
  console.error('baseline sync FAILED (last-good data left intact):', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
