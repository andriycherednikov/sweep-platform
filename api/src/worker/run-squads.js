import { asc } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { syncSquads } from './sync-squads.js'
import { competition } from '../db/schema.js'

const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
try {
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [comp] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  if (!comp) { console.error('no competition found — run competition:add or db:seed first'); process.exit(1) }
  const n = await syncSquads(db, provider)
  console.log(`squads sync ok: ${n} team squads stored`)
} catch (e) {
  console.error('squads sync FAILED (last-good data left intact):', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
