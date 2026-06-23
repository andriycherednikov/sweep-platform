import cron from 'node-cron'
import { createPool, createDb } from './db/client.js'
import { createApiFootballProvider } from './providers/api-football-provider.js'
import { syncBaseline } from './worker/baseline-sync.js'
import { pollLive, pollEvents, pollStatistics, pollLineups, fixturesToPoll, isLineupWindow } from './worker/live-poller.js'
import { resolveCrosswalk } from './worker/crosswalk.js'
import { publish } from './events/notify.js'
import { recomputeStandings } from './worker/recompute-standings.js'
import { settleBets, settleStaleBets } from './coins/settle.js'
import { grantMatchRewards } from './coins/rewards.js'
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

// Safety net for stale bets: the live tick only grades a fixture at the moment it flips
// final, so a missed transition (worker down, late result) leaves open bets stranded on a
// finished match. Sweep them at boot and every 10 minutes via the idempotent settler.
async function settleStale(reason) {
  try {
    const n = await settleStaleBets(db, (e) => publish(db, e))
    if (n) console.log(`[settle-stale:${reason}] swept ${n} fixture(s)`)
  } catch (e) { console.error(`[settle-stale:${reason}] failed:`, e.message) }
}
cron.schedule('*/10 * * * *', () => settleStale('cron'))
await settleStale('boot')

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
// Re-entrancy guard: if a tick runs long (slow API), skip the next one so two
// overlapping polls can't both see the same event as "new" and double-publish it.
let ticking = false
setInterval(async () => {
  if (ticking) return
  ticking = true
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
      // per-team match statistics (shots/possession/corners/fouls) — passive panel, no SSE
      const st = await pollStatistics(db, provider, liveIds, await resolveCrosswalk(db))
      if (st) console.log(`[stats] updated ${st}`)
      // any polled fixture just go final? recompute the table now + queue an official reconcile
      const after = await db.select({ id: fixture.id, status: fixture.status }).from(fixture).where(inArray(fixture.id, liveIds))
      const newlyFinal = after.filter((r) => r.status === 'final' && !prevFinal.has(r.id))
      if (newlyFinal.length) {
        await recomputeStandings(db)
        // settle each fixture independently — one bad fixture must not block the others
        // (they're already 'final', so a skipped settlement would never be retried)
        for (const r of newlyFinal) {
          try { await settleBets(db, r.id, (e) => publish(db, e)) }
          catch (e) { console.error(`[settleBets] fixture ${r.id} failed:`, e.message) }
          try { await grantMatchRewards(db, r.id, (e) => publish(db, e)) }
          catch (e) { console.error(`[grantMatchRewards] fixture ${r.id} failed:`, e.message) }
        }
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
  finally { ticking = false }
}, 60_000)

console.log(`worker up — season ${season}`)
