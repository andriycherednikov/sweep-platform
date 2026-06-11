import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { syncSquads } from './sync-squads.js'

const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
try {
  const n = await syncSquads(db, provider)
  console.log(`squads sync ok: ${n} team squads stored`)
} catch (e) {
  console.error('squads sync FAILED (last-good data left intact):', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
