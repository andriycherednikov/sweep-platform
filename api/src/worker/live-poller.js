import { eq, inArray, and, isNull } from 'drizzle-orm'
import { fixture, syncLog } from '../db/schema.js'
import { mapLineups, mapEvents } from '../providers/mapping.js'

/** True if `now` is within `windowMin` minutes after (or 10 min before) any kickoff. */
export function isLiveWindow(now, kickoffs, windowMin = 150) {
  const t = now.getTime()
  return kickoffs.some((k) => {
    const ko = k.getTime()
    return t >= ko - 10 * 60_000 && t <= ko + windowMin * 60_000
  })
}

/**
 * Which fixtures to poll by id this tick: ones in their live window, PLUS any non-final
 * fixture whose kickoff has already passed (within `recoverHours`). The recovery arm
 * auto-heals matches we missed — worker was down during kickoff, or the game finished
 * after its window closed — so they reconcile to 'final' instead of sitting stuck 'live'.
 * @param {{id:string, ko:string|Date, status:string}[]} rows
 * @returns {string[]} unique fixture ids
 */
export function fixturesToPoll(rows, now, { recoverHours = 24 } = {}) {
  const t = now.getTime()
  const ids = new Set()
  for (const r of rows) {
    const ko = new Date(r.ko).getTime()
    const inWindow = isLiveWindow(now, [new Date(r.ko)])
    const recover = r.status !== 'final' && ko < t && ko > t - recoverHours * 3600_000
    if (inWindow || recover) ids.add(r.id)
  }
  return [...ids]
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
 * Poll the given fixtures BY ID (not the live=all feed) and update score/minute/status.
 * Polling by id returns a fixture through its live→final transition — live=all drops a match
 * the moment it ends, so it could never flip a finished game to 'final'. Only writes (and
 * publishes) on an actual change, so unchanged in-window fixtures cost nothing downstream.
 * @param {string[]} ids fixtures whose kickoff window is currently active
 * @returns {Promise<number>} count of fixtures changed
 */
export async function pollLive(db, provider, ids, publish = () => {}) {
  if (!ids || ids.length === 0) return 0
  try {
    const fetched = await provider.fetchFixturesByIds(ids)
    const current = await db.select().from(fixture).where(inArray(fixture.id, ids))
    const byId = new Map(current.map((r) => [r.id, r]))
    let updated = 0
    for (const f of fetched) {
      const cur = byId.get(f.id)
      if (!cur) continue
      if (cur.status === f.status && cur.score1 === f.score1 && cur.score2 === f.score2 && cur.minute === f.minute
        && (cur.htScore1 ?? null) === (f.htScore1 ?? null) && (cur.htScore2 ?? null) === (f.htScore2 ?? null)) continue
      await db.update(fixture)
        .set({ status: f.status, score1: f.score1, score2: f.score2, minute: f.minute, htScore1: f.htScore1, htScore2: f.htScore2, updatedAt: new Date() })
        .where(eq(fixture.id, f.id))
      updated++
      publish({ type: 'score', fixtureId: f.id, status: f.status, score: [f.score1, f.score2], minute: f.minute })
    }
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'ok', counts: { polled: ids.length, updated } })
    return updated
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}

/**
 * Poll /fixtures/events for the given in-window fixtures; store the full list on
 * `fixture.events` and publish only NEWLY-seen events (diffed by event id).
 *
 * A null stored list means we've never polled this fixture — baseline it silently so a
 * worker restart mid-match doesn't replay every prior goal as a fresh notification.
 * Goals carry the fixture's current stored score (pollLive runs earlier in the tick).
 * Best-effort per fixture: a fetch error for one fixture never blocks the others.
 * @returns {Promise<number>} count of events published
 */
export async function pollEvents(db, provider, ids, crosswalk, publish = () => {}) {
  if (!ids || ids.length === 0) return 0
  const rows = await db
    .select({ id: fixture.id, events: fixture.events, score1: fixture.score1, score2: fixture.score2 })
    .from(fixture).where(inArray(fixture.id, ids))
  const byId = new Map(rows.map((r) => [r.id, r]))
  let emitted = 0
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) continue
    try {
      const fetched = mapEvents(await provider.fetchEvents(id), crosswalk) // always an array
      const stored = row.events
      if (stored === null) { // never polled → baseline silently
        await db.update(fixture).set({ events: fetched, updatedAt: new Date() }).where(eq(fixture.id, id))
        continue
      }
      const storedIds = new Set(stored.map((e) => e.id))
      const fresh = fetched.filter((e) => !storedIds.has(e.id))
      if (fresh.length === 0 && fetched.length === stored.length) continue // unchanged
      await db.update(fixture).set({ events: fetched, updatedAt: new Date() }).where(eq(fixture.id, id))
      for (const e of fresh) {
        if (e.type === 'goal') {
          publish({ type: 'goal', fixtureId: id, teamCode: e.teamCode, player: e.player, assist: e.assist, minute: e.minute, detail: e.detail, score: [row.score1, row.score2] })
        } else {
          publish({ type: 'card', fixtureId: id, teamCode: e.teamCode, player: e.player, minute: e.minute, card: e.card, detail: e.detail })
        }
        emitted++
      }
    } catch { /* best-effort per fixture */ }
  }
  await db.insert(syncLog).values({ source: 'api-football', kind: 'events', status: 'ok', counts: { polled: ids.length, emitted } })
  return emitted
}

/**
 * Backfill events for already-finished matches that were never event-polled (e.g. games
 * that ended before this feature shipped, or while the worker was down). Selects every
 * `final` fixture whose `events` is still null and runs them through pollEvents, which —
 * because their stored list is null — baselines each silently (stores the goals/cards,
 * publishes nothing). Idempotent: once stored (even as []), a fixture is no longer null,
 * so subsequent runs select it no more and the call converges to a single cheap SELECT.
 * @returns {Promise<number>} number of finished fixtures backfilled
 */
export async function backfillFinalEvents(db, provider, crosswalk) {
  const rows = await db.select({ id: fixture.id }).from(fixture)
    .where(and(eq(fixture.status, 'final'), isNull(fixture.events)))
  if (rows.length === 0) return 0
  await pollEvents(db, provider, rows.map((r) => r.id), crosswalk) // no publish → silent baseline
  return rows.length
}
