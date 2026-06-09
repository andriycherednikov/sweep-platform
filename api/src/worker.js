import cron from 'node-cron'
import { createPool, createDb } from './db/client.js'
import { createApiFootballProvider } from './providers/api-football-provider.js'
import { syncBaseline } from './worker/baseline-sync.js'
import { pollLive, isLiveWindow } from './worker/live-poller.js'
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
setInterval(async () => {
  try {
    const kickoffs = (await db.select({ ko: fixture.kickoffUtc }).from(fixture)).map((r) => new Date(r.ko))
    if (!isLiveWindow(new Date(), kickoffs)) return
    const n = await pollLive(db, provider, (e) => publish(db, e))
    if (n) console.log(`[live] updated ${n}`)
  } catch (e) { console.error('[live] failed:', e.message) }
}, 60_000)

console.log(`worker up — season ${season}`)
