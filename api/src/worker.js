import cron from 'node-cron'
import { createPool, createDb } from './db/client.js'
import { createApiFootballProvider } from './providers/api-football-provider.js'
import { syncBaseline } from './worker/baseline-sync.js'
import { pollLive, pollLineups, fixturesToPoll, isLineupWindow } from './worker/live-poller.js'
import { resolveCrosswalk } from './worker/crosswalk.js'
import { publish } from './events/notify.js'
import { fixture } from './db/schema.js'

const season = Number(process.env.WC_SEASON ?? 2026)
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })

async function baseline(reason) {
  try {
    const r = await syncBaseline(db, provider, { season })
    await publish(db, { type: 'sync' })
    console.log(`[baseline:${reason}] ${r.fixtures} fixtures`)
  } catch (e) { console.error(`[baseline:${reason}] failed (last-good intact):`, e.message) }
}

// Baseline a few times a day (00:10, 06:10, 12:10, 18:10 UTC) + once at boot.
cron.schedule('10 0,6,12,18 * * *', () => baseline('cron'))
await baseline('boot')

// Live tick every 60s, but only hit the API inside a kickoff window.
// Scores poll in the ±150m live window; lineups in a wider ~45m pre-kickoff window.
setInterval(async () => {
  try {
    const rows = await db.select({ id: fixture.id, ko: fixture.kickoffUtc, status: fixture.status, lineups: fixture.lineups }).from(fixture)
    const now = new Date()
    const kickoffs = rows.map((r) => new Date(r.ko))
    // in-window fixtures + recovery sweep (missed kickoffs / stuck-live games)
    const liveIds = fixturesToPoll(rows, now)
    if (liveIds.length) {
      const n = await pollLive(db, provider, liveIds, (e) => publish(db, e))
      if (n) console.log(`[live] updated ${n}`)
    }
    if (isLineupWindow(now, kickoffs)) {
      const candidates = rows.filter((r) => !r.lineups && isLineupWindow(now, [new Date(r.ko)]))
      if (candidates.length) {
        const m = await pollLineups(db, provider, candidates, await resolveCrosswalk(db), (e) => publish(db, e))
        if (m) console.log(`[lineups] updated ${m}`)
      }
    }
  } catch (e) { console.error('[tick] failed:', e.message) }
}, 60_000)

console.log(`worker up — season ${season}`)
