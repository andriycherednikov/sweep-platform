import { eq } from 'drizzle-orm'
import { fixture, syncLog } from '../db/schema.js'
import { mapLineups } from '../providers/mapping.js'

/** True if `now` is within `windowMin` minutes after (or 10 min before) any kickoff. */
export function isLiveWindow(now, kickoffs, windowMin = 150) {
  const t = now.getTime()
  return kickoffs.some((k) => {
    const ko = k.getTime()
    return t >= ko - 10 * 60_000 && t <= ko + windowMin * 60_000
  })
}

/**
 * True from `leadMin` minutes before any kickoff through the match — a longer lead than
 * scores, because lineups are published ~20–40 min pre-kickoff.
 */
export function isLineupWindow(now, kickoffs, leadMin = 45) {
  const t = now.getTime()
  return kickoffs.some((k) => {
    const ko = k.getTime()
    return t >= ko - leadMin * 60_000 && t <= ko + 150 * 60_000
  })
}

/**
 * For each fixture lacking a team sheet, fetch + store its lineups (formation + XI).
 * Best-effort per fixture; only writes when the provider returns real data, so a failed
 * or not-yet-published fetch never wipes prior lineups.
 * @returns {Promise<number>} count of fixtures whose lineups were stored
 */
export async function pollLineups(db, provider, fixtures, crosswalk, publish = () => {}) {
  let updated = 0
  let checked = 0
  for (const f of fixtures) {
    if (f.lineups) continue // already have a team sheet — don't refetch
    checked++
    try {
      const lineups = mapLineups(await provider.fetchLineups(f.id), crosswalk)
      if (!lineups) continue // none published yet → leave as-is
      await db.update(fixture).set({ lineups, updatedAt: new Date() }).where(eq(fixture.id, f.id))
      updated++
      publish({ type: 'lineups', fixtureId: f.id })
    } catch { /* best-effort per fixture */ }
  }
  await db.insert(syncLog).values({ source: 'api-football', kind: 'lineups', status: 'ok', counts: { checked, updated } })
  return updated
}

/**
 * Poll all in-play fixtures and update score/minute/status for the ones we know.
 * @returns {Promise<number>} count of fixtures updated
 */
export async function pollLive(db, provider, publish = () => {}) {
  try {
    const live = await provider.fetchLive()
    let updated = 0
    for (const f of live) {
      const res = await db.update(fixture)
        .set({ status: f.status, score1: f.score1, score2: f.score2, minute: f.minute, updatedAt: new Date() })
        .where(eq(fixture.id, f.id))
        .returning({ id: fixture.id })
      if (res.length) {
        updated += res.length
        publish({ type: 'score', fixtureId: f.id, status: f.status, score: [f.score1, f.score2], minute: f.minute })
      }
    }
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'ok', counts: { live: live.length, updated } })
    return updated
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
