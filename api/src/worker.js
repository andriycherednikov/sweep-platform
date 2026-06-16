import cron from 'node-cron'
import { createPool, createDb } from './db/client.js'
import { createApiFootballProvider } from './providers/api-football-provider.js'
import { syncBaseline } from './worker/baseline-sync.js'
import { pollLive, pollEvents, pollLineups, fixturesToPoll, isLineupWindow } from './worker/live-poller.js'
import { resolveCrosswalk } from './worker/crosswalk.js'
import { publish } from './events/notify.js'
import { recomputeStandings } from './worker/recompute-standings.js'
import { settleBets } from './coins/settle.js'
import { inArray } from 'drizzle-orm'
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

// When a match finishes we recompute the table instantly from our own results, then queue
// ONE official provider reconcile ~5 min later — debounced so a cluster of finals triggers
// a single baseline, not one per game.
let finalReconcileTimer = null
function scheduleFinalReconcile() {
  if (finalReconcileTimer) return
  finalReconcileTimer = setTimeout(() => { finalReconcileTimer = null; baseline('final-reconcile') }, 5 * 60_000)
}

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
      const prevFinal = new Set(rows.filter((r) => r.status === 'final').map((r) => r.id))
      const n = await pollLive(db, provider, liveIds, (e) => publish(db, e))
      if (n) console.log(`[live] updated ${n}`)
      // events poll AFTER scores, so a goal notification carries the just-updated score
      const e = await pollEvents(db, provider, liveIds, await resolveCrosswalk(db), (ev) => publish(db, ev))
      if (e) console.log(`[events] ${e} new`)
      // any polled fixture just go final? recompute the table now + queue an official reconcile
      const after = await db.select({ id: fixture.id, status: fixture.status }).from(fixture).where(inArray(fixture.id, liveIds))
      const newlyFinal = after.filter((r) => r.status === 'final' && !prevFinal.has(r.id))
      if (newlyFinal.length) {
        await recomputeStandings(db)
        for (const r of newlyFinal) await settleBets(db, r.id, (e) => publish(db, e))
        await publish(db, { type: 'sync' })
        console.log(`[standings] recomputed after ${newlyFinal.length} final(s); official reconcile in 5m`)
        scheduleFinalReconcile()
      }
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
