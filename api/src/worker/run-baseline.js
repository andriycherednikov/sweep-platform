import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { syncBaseline } from './baseline-sync.js'

const season = Number(process.env.WC_SEASON ?? 2026)
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
try {
  const r = await syncBaseline(db, provider, { season })
  console.log(`baseline sync ok: ${r.fixtures} fixtures, ${r.standings} standings`)
} catch (e) {
  console.error('baseline sync FAILED (last-good data left intact):', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
