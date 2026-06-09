import { eq } from 'drizzle-orm'
import { fixture, syncLog } from '../db/schema.js'

/** True if `now` is within `windowMin` minutes after (or 10 min before) any kickoff. */
export function isLiveWindow(now, kickoffs, windowMin = 150) {
  const t = now.getTime()
  return kickoffs.some((k) => {
    const ko = k.getTime()
    return t >= ko - 10 * 60_000 && t <= ko + windowMin * 60_000
  })
}

/**
 * Poll all in-play fixtures and update score/minute/status for the ones we know.
 * @returns {Promise<number>} count of fixtures updated
 */
export async function pollLive(db, provider) {
  try {
    const live = await provider.fetchLive()
    let updated = 0
    for (const f of live) {
      const res = await db.update(fixture)
        .set({ status: f.status, score1: f.score1, score2: f.score2, minute: f.minute, updatedAt: new Date() })
        .where(eq(fixture.id, f.id))
        .returning({ id: fixture.id })
      updated += res.length
    }
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'ok', counts: { live: live.length, updated } })
    return updated
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
