import cron from 'node-cron'
import { createPool, createDb } from './db/client.js'
import { providerFor, PROVIDER_KEYS } from './providers/registry.js'
import { syncBaseline } from './worker/baseline-sync.js'
import { syncCatalog } from './worker/catalog-sync.js'
import { syncCompetitors } from './worker/sync-competitors.js'
import { pollLive, pollEvents, pollStatistics, pollLineups, fixturesToPoll, isLineupWindow } from './worker/live-poller.js'
import { resolveCrosswalk } from './worker/crosswalk.js'
import { cleanupExpiredAuth } from './accounts/auth.js'
import { publish } from './events/notify.js'
import { recomputeStandings } from './worker/recompute-standings.js'
import { settleBets, settleStaleBets } from './coins/settle.js'
import { grantMatchRewards } from './coins/rewards.js'
import { eq, inArray, isNull } from 'drizzle-orm'
import { competition, event, sweep } from './db/schema.js'

const pool = createPool()
const db = createDb(pool)

/** Competitions worth syncing: bound to at least one live (unarchived) sweep — the
 *  §7 dedupe-by-competition (N sweeps on one competition = one poll). Empty DB → empty
 *  list → both loops below no-op instead of crashing on boot. */
async function activeCompetitions(db) {
  const rows = await db.selectDistinct({ id: sweep.competitionId }).from(sweep)
    .where(isNull(sweep.archivedAt))
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (!ids.length) return []
  return db.select().from(competition).where(inArray(competition.id, ids))
}

async function baseline(reason, { syncRosters = false } = {}) {
  const comps = await activeCompetitions(db)
  // ponytail: sequential per-competition loop; parallelize if >10 active competitions ever matters (P4 concern).
  for (const comp of comps) {
    try {
      const provider = providerFor(comp)
      if (syncRosters && provider.dropUnknownTeams) {
        // feed-born rosters follow feed churn (trades/relocations); curated football stays CLI-driven.
        try { await syncCompetitors(db, provider, comp) }
        catch (e) { console.error(`[syncCompetitors] ${comp.id} failed:`, e.message) }
      }
      const r = await syncBaseline(db, provider, comp)
      if (r.newlyFinal.length) {
        await recomputeStandings(db, comp.id)
        // settle each fixture independently — one bad fixture must not block the others
        // (they're already 'final', so a skipped settlement would never be retried)
        for (const id of r.newlyFinal) {
          try { await settleBets(db, id, (e) => publish(db, e)) }
          catch (e) { console.error(`[settleBets] fixture ${id} failed:`, e.message) }
          try { await grantMatchRewards(db, id, (e) => publish(db, e)) }
          catch (e) { console.error(`[grantMatchRewards] fixture ${id} failed:`, e.message) }
        }
      }
      await publish(db, { type: 'sync' })
      console.log(`[baseline:${reason}] ${comp.id}: ${r.fixtures} fixtures`)
    } catch (e) { console.error(`[baseline:${reason}] ${comp.id} failed (last-good intact):`, e.message) }
  }
}

// Once a day (00:10 UTC): refresh each provider's catalog (~1 request/provider), then
// baseline with a feed-born roster re-sync so trades/relocations aren't stuck until a
// manual CLI run. Catalog failures are per-provider — one provider's outage must not
// block the other's refresh, nor the baseline that follows.
async function daily() {
  try { await cleanupExpiredAuth(db) }
  catch (e) { console.error('[daily] auth cleanup failed:', e.message) }
  for (const key of PROVIDER_KEYS) {
    try { await syncCatalog(db, key, providerFor({ provider: key })) }
    catch (e) { console.error(`[daily] catalog ${key} failed:`, e.message) }
  }
  await baseline('cron-daily', { syncRosters: true })
}
cron.schedule('10 0 * * *', () => daily())

// Baseline the rest of the day (06:10, 12:10, 18:10 UTC) + once at boot.
cron.schedule('10 6,12,18 * * *', () => baseline('cron'))
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
// a single baseline, not one per game. baseline() loops every active competition, so this
// stays a single timer regardless of how many competitions are live.
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
    // ponytail: sequential per-competition loop; parallelize if >10 active competitions ever matters (P4 concern).
    for (const comp of await activeCompetitions(db)) {
      const competitionId = comp.id
      try {
        const provider = providerFor(comp)
        if (!provider.live) continue // baseline-only sport (NBA)
        const rows = await db.select({ id: event.id, ko: event.startUtc, status: event.status, detail: event.detail })
          .from(event).where(eq(event.competitionId, competitionId))
        const now = new Date()
        const kickoffs = rows.map((r) => new Date(r.ko))
        // in-window fixtures + recovery sweep (missed kickoffs / stuck-live games)
        const liveIds = fixturesToPoll(rows, now)
        if (liveIds.length) {
          const prevFinal = new Set(rows.filter((r) => r.status === 'final').map((r) => r.id))
          const n = await pollLive(db, provider, liveIds, (e) => publish(db, e))
          if (n) console.log(`[live] updated ${n}`)
          // events poll AFTER scores, so a goal notification carries the just-updated score
          const crosswalk = await resolveCrosswalk(db, competitionId) // static within a match window — resolve once per tick
          const e = await pollEvents(db, provider, liveIds, crosswalk, (ev) => publish(db, ev))
          if (e) console.log(`[events] ${e} new`)
          // per-team match statistics (shots/possession/corners/fouls) — passive panel, no SSE
          const st = await pollStatistics(db, provider, liveIds, crosswalk)
          if (st) console.log(`[stats] updated ${st}`)
          // any polled fixture just go final? recompute the table now + queue an official reconcile
          const after = await db.select({ id: event.id, status: event.status }).from(event).where(inArray(event.id, liveIds))
          const newlyFinal = after.filter((r) => r.status === 'final' && !prevFinal.has(r.id))
          if (newlyFinal.length) {
            await recomputeStandings(db, competitionId)
            // settle each fixture independently — one bad fixture must not block the others
            // (they're already 'final', so a skipped settlement would never be retried)
            for (const r of newlyFinal) {
              try { await settleBets(db, r.id, (e) => publish(db, e)) }
              catch (e) { console.error(`[settleBets] fixture ${r.id} failed:`, e.message) }
              try { await grantMatchRewards(db, r.id, (e) => publish(db, e)) }
              catch (e) { console.error(`[grantMatchRewards] fixture ${r.id} failed:`, e.message) }
            }
            await publish(db, { type: 'sync' })
            console.log(`[standings] ${competitionId}: recomputed after ${newlyFinal.length} final(s); official reconcile in 5m`)
            scheduleFinalReconcile()
          }
        }
        if (isLineupWindow(now, kickoffs)) {
          const candidates = rows.filter((r) => !r.detail?.lineups && isLineupWindow(now, [new Date(r.ko)]))
          if (candidates.length) {
            const m = await pollLineups(db, provider, candidates, await resolveCrosswalk(db, competitionId), (e) => publish(db, e))
            if (m) console.log(`[lineups] updated ${m}`)
          }
        }
      } catch (e) { console.error(`[tick] ${competitionId} failed:`, e.message) }
    }
  } catch (e) { console.error('[tick] failed:', e.message) }
  finally { ticking = false }
}, 60_000)

console.log('worker up')
