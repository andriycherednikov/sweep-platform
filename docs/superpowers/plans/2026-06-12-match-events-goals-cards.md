# Match Events (Goal Scorers & Cards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture goal-scorer and yellow/red-card events from API-Football, store them per fixture, emit each new event over SSE, and surface them as enriched floating notifications plus a persistent timeline on the match sheet.

**Architecture:** A new data path parallel to the existing score poller. The worker fetches `/fixtures/events` for in-window fixtures, maps to a `{goal|card}` shape, stores the full list on a new `fixture.events` jsonb column, and publishes only newly-seen events. The score-diff path keeps owning kick-off / full-time / score numbers but stops emitting its inferred `goal` popup (the events feed now owns goal popups, with the real scorer). The frontend routes the new `goal`/`card` SSE types into floating notifications and renders the stored list as a match-sheet timeline.

**Tech Stack:** Node 22 (ESM) + Fastify 5 + Drizzle ORM/Postgres (`api/`); Vite + React 18 (`web/`); Vitest + Testcontainers. Spec: `docs/superpowers/specs/2026-06-12-match-events-goals-cards-design.md`.

**Design decisions locked here (read before starting):**
- **`fixture.events` is nullable with NO default.** `null` means *never polled* → the worker baselines it silently (no backfill spam on a mid-match worker restart). An array (incl. `[]`) means *polled at least once* → the worker diffs and emits only new events. The frontend reads `events ?? []`.
- **Stable event `id`** (the API gives none): `[elapsed, extra ?? 0, teamCode, player, type, detail].join('|')`. Used to diff fetched-vs-stored.
- **`minute`** stored as the numeric `time.elapsed`; stoppage `time.extra` is folded into the `id` only (keeps sorting numeric; stoppage goals display their base minute).
- **Tick ordering:** in `worker.js`, `pollLive` runs *before* `pollEvents` so the goal event can carry the freshly-updated score read from the fixture row.
- **Own goals / penalties:** `teamCode` is whatever the API attaches to the event (for an own goal, the scoring player's team); the actual match score on the popup stays correct. The `detail` label ("Penalty" / "Own Goal") is surfaced as a small tag.

---

## File Structure

**Backend (`api/`):**
- `src/db/schema.js` — add `events` jsonb column to `fixture` (modify).
- `migrations/` — new generated migration (drizzle-kit).
- `src/providers/mapping.js` — add `mapEvents()` (modify).
- `src/providers/api-football-provider.js` — add `fetchEvents()` (modify).
- `src/providers/recorded-provider.js` — add `fetchEvents()` (modify).
- `src/providers/football-provider.js` — add `fetchEvents` to typedef (modify).
- `src/worker/live-poller.js` — add `pollEvents()` (modify).
- `src/worker.js` — wire `pollEvents` into the tick (modify).
- `src/serialize.js` — include `events` in the fixture payload (modify).

**Frontend (`web/`):**
- `src/lib/assemble.js` — carry `events` onto the assembled fixture (modify).
- `src/hooks/useEventStream.js` — drop score-diff goal; route `goal`/`card` (modify).
- `src/FloatingReactions.jsx` — enrich `goal`, add `card` branch (modify).
- `src/screens-detail.jsx` — add `MatchTimeline` block to `MatchSheet` (modify).

**Tests:**
- `api/test/schema.test.js`, `api/test/mapping.test.js`, `api/test/api-football-provider.test.js`, `api/test/live-poller.test.js`, `api/test/serialize.test.js` (new), `web/src/lib/assemble.test.js`, `web/src/hooks/useEventStream.test.jsx`, `web/src/FloatingReactions.test.jsx`, `web/src/screens-detail.test.jsx`.

Run backend tests with `npm run test` (root) — requires Docker running for Testcontainers. Run web tests with `npm run test -w web`.

---

### Task 1: Schema — `fixture.events` jsonb column + migration

**Files:**
- Modify: `api/src/db/schema.js:55` (next to `lineups`)
- Test: `api/test/schema.test.js`
- Create: `api/migrations/000X_*.sql` (generated)

- [ ] **Step 1: Write the failing test**

Add to `api/test/schema.test.js` (after the existing `fixture.lineups round-trips` test, ~line 15):

```js
test('fixture.events round-trips a JSON array and defaults to null', async () => {
  const data = [{ id: '23|0|hr|Modric|goal|Penalty', type: 'goal', teamCode: 'hr', player: 'Modric', minute: 23, detail: 'Penalty', assist: null }]
  await db.update(fixture).set({ events: data }).where(eq(fixture.id, 'm0'))
  const [row] = await db.select().from(fixture).where(eq(fixture.id, 'm0'))
  expect(row.events).toEqual(data)
  await db.update(fixture).set({ events: null }).where(eq(fixture.id, 'm0')) // restore seed
  const [restored] = await db.select().from(fixture).where(eq(fixture.id, 'm0'))
  expect(restored.events).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- schema`
Expected: FAIL — `column "events" does not exist` (schema/migration not yet applied).

- [ ] **Step 3: Add the column to the schema**

In `api/src/db/schema.js`, in the `fixture` table, add the `events` column immediately after the `lineups` line (line 55):

```js
  lineups: jsonb('lineups'),
  events: jsonb('events'),
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate -w api`
Expected: a new file `api/migrations/000X_*.sql` containing `ALTER TABLE "fixture" ADD COLUMN "events" jsonb;` and an updated `migrations/meta/` journal.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w api -- schema`
Expected: PASS (Testcontainers applies all migrations including the new one).

- [ ] **Step 6: Commit**

```bash
git add api/src/db/schema.js api/migrations api/test/schema.test.js
git commit -m "feat(api): add events jsonb column to fixture"
```

---

### Task 2: `mapEvents` — map raw `/fixtures/events` to goal/card shapes

**Files:**
- Modify: `api/src/providers/mapping.js` (add `mapEvents`, after `mapLineups`, ~line 145)
- Test: `api/test/mapping.test.js`

- [ ] **Step 1: Write the failing test**

Add to `api/test/mapping.test.js`. Update the import on line 3 to include `mapEvents`:

```js
import { mapStatus, parseRound, mapFixture, mapStanding, mapPrediction, mapTeam, mapOdds, mapLineups, mapSquad, mapEvents } from '../src/providers/mapping.js'
```

Then append these tests:

```js
const XW = new Map([[3001, 'hr'], [3002, 'be']])
const rawEvents = (list) => ({ response: list })

test('mapEvents keeps only Goal and Card, dropping subst/Var', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 23, extra: null }, team: { id: 3001 }, player: { name: 'Modric' }, assist: { name: 'Perisic' }, type: 'Goal', detail: 'Normal Goal' },
    { time: { elapsed: 60, extra: null }, team: { id: 3002 }, player: { name: 'Lukaku' }, assist: { name: null }, type: 'subst', detail: 'Substitution 1' },
    { time: { elapsed: 70, extra: null }, team: { id: 3001 }, player: { name: 'VAR' }, type: 'Var', detail: 'Goal cancelled' },
  ]), XW)
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ type: 'goal', teamCode: 'hr', player: 'Modric', minute: 23, detail: 'Normal Goal', assist: 'Perisic' })
})

test('mapEvents derives card colour from detail (yellow / red / second yellow)', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 30, extra: null }, team: { id: 3001 }, player: { name: 'A' }, type: 'Card', detail: 'Yellow Card' },
    { time: { elapsed: 55, extra: null }, team: { id: 3002 }, player: { name: 'B' }, type: 'Card', detail: 'Red Card' },
    { time: { elapsed: 80, extra: null }, team: { id: 3002 }, player: { name: 'C' }, type: 'Card', detail: 'Second Yellow card' },
  ]), XW)
  expect(out.map((e) => e.card)).toEqual(['yellow', 'red', 'red'])
  expect(out[0]).not.toHaveProperty('assist') // cards carry no assist
})

test('mapEvents labels penalty and own-goal via detail, null-safe assist', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 12, extra: null }, team: { id: 3001 }, player: { name: 'P' }, assist: { name: null }, type: 'Goal', detail: 'Penalty' },
    { time: { elapsed: 41, extra: null }, team: { id: 3002 }, player: { name: 'O' }, type: 'Goal', detail: 'Own Goal' },
  ]), XW)
  expect(out[0]).toMatchObject({ type: 'goal', detail: 'Penalty', assist: null })
  expect(out[1]).toMatchObject({ type: 'goal', detail: 'Own Goal', assist: null })
})

test('mapEvents drops events whose team is not in the crosswalk', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 5, extra: null }, team: { id: 9999 }, player: { name: 'X' }, type: 'Goal', detail: 'Normal Goal' },
  ]), XW)
  expect(out).toEqual([])
})

test('mapEvents produces a stable id from elapsed/extra/team/player/type/detail', () => {
  const raw = rawEvents([{ time: { elapsed: 45, extra: 2 }, team: { id: 3001 }, player: { name: 'Modric' }, type: 'Goal', detail: 'Normal Goal' }])
  const a = mapEvents(raw, XW)[0].id
  const b = mapEvents(raw, XW)[0].id
  expect(a).toBe(b)
  expect(a).toBe('45|2|hr|Modric|goal|Normal Goal')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- mapping`
Expected: FAIL — `mapEvents is not a function`.

- [ ] **Step 3: Implement `mapEvents`**

Append to `api/src/providers/mapping.js`:

```js
/**
 * /fixtures/events response + a crosswalk (Map<providerTeamId, teamCode>) →
 * [{ id, type:'goal'|'card', teamCode, player, minute, detail, assist?, card? }].
 * Keeps only Goal & Card; drops subst/Var and any team not in the crosswalk.
 * `minute` is the numeric elapsed clock; stoppage `extra` is folded into `id` only,
 * which is a deterministic composite the worker uses to diff fetched-vs-stored events.
 */
export function mapEvents(rawResponse, crosswalkMap) {
  const events = rawResponse?.response ?? []
  const out = []
  for (const e of events) {
    const type = e.type === 'Goal' ? 'goal' : e.type === 'Card' ? 'card' : null
    if (!type) continue
    const teamCode = crosswalkMap.get(e.team?.id)
    if (!teamCode) continue
    const elapsed = e.time?.elapsed ?? 0
    const extra = e.time?.extra ?? null
    const player = e.player?.name ?? null
    const detail = e.detail ?? null
    const ev = { id: [elapsed, extra ?? 0, teamCode, player, type, detail].join('|'), type, teamCode, player, minute: elapsed, detail }
    if (type === 'goal') ev.assist = e.assist?.name ?? null
    if (type === 'card') ev.card = /red|second yellow/i.test(detail ?? '') ? 'red' : 'yellow'
    out.push(ev)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- mapping`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/providers/mapping.js api/test/mapping.test.js
git commit -m "feat(api): map /fixtures/events to goal & card events"
```

---

### Task 3: Provider — `fetchEvents` (raw `/fixtures/events`)

**Files:**
- Modify: `api/src/providers/api-football-provider.js:67` (next to `fetchLineups`)
- Modify: `api/src/providers/recorded-provider.js`
- Modify: `api/src/providers/football-provider.js:34` (typedef)
- Test: `api/test/api-football-provider.test.js`

- [ ] **Step 1: Write the failing test**

Append to `api/test/api-football-provider.test.js`:

```js
test('fetchEvents queries /fixtures/events?fixture= and returns raw json', async () => {
  const raw = { response: [{ time: { elapsed: 23 }, team: { id: 3001 }, player: { name: 'Modric' }, type: 'Goal', detail: 'Normal Goal' }] }
  const fetch = fakeFetch({ '/fixtures/events': raw })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const out = await p.fetchEvents('9002')
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.pathname).toBe('/fixtures/events')
  expect(calledUrl.searchParams.get('fixture')).toBe('9002')
  expect(out).toEqual(raw) // raw passthrough — crosswalk mapping is the poller's job
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- api-football-provider`
Expected: FAIL — `p.fetchEvents is not a function`.

- [ ] **Step 3: Implement `fetchEvents` on the real provider**

In `api/src/providers/api-football-provider.js`, add after the `fetchLineups` method (line 70):

```js
    async fetchEvents(fixtureId) {
      // raw json — crosswalk resolution is a DB concern, done by the poller
      return get('/fixtures/events', { fixture: fixtureId })
    },
```

- [ ] **Step 4: Add `fetchEvents` to the recorded provider**

In `api/src/providers/recorded-provider.js`, add `events` to the destructured params (line 4) and a method (after `fetchLineups`, line 16):

```js
export function createRecordedProvider({ fixtures, live, standings, predictions, teams, odds, lineups, squads, events } = {}) {
```

```js
    async fetchEvents() { return events ?? { response: [] } },
```

- [ ] **Step 5: Add `fetchEvents` to the typedef**

In `api/src/providers/football-provider.js`, add after the `fetchLineups` line (line 34):

```js
 * @property {(fixtureId:string) => Promise<object>} fetchEvents  raw /fixtures/events json
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w api -- api-football-provider`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/providers/api-football-provider.js api/src/providers/recorded-provider.js api/src/providers/football-provider.js api/test/api-football-provider.test.js
git commit -m "feat(api): add fetchEvents to the football provider"
```

---

### Task 4: Worker — `pollEvents` (diff, persist, emit new events)

**Files:**
- Modify: `api/src/worker/live-poller.js` (add `pollEvents`; import `mapEvents`)
- Test: `api/test/live-poller.test.js`

- [ ] **Step 1: Write the failing test**

In `api/test/live-poller.test.js`, update the import on line 8 to include `pollEvents`:

```js
import { pollLive, isLiveWindow, pollLineups, isLineupWindow, fixturesToPoll, pollEvents } from '../src/worker/live-poller.js'
```

Append these tests (they rely on the existing `beforeAll` crosswalk `hr→3001, be→3002, gh→3003` and the pruned fixture set; fixture `9002` exists):

```js
const goalRaw = (over = {}) => ({ time: { elapsed: 23, extra: null }, team: { id: 3001 }, player: { name: 'Modric' }, assist: { name: null }, type: 'Goal', detail: 'Normal Goal', ...over })
const cardRaw = (over = {}) => ({ time: { elapsed: 30, extra: null }, team: { id: 3002 }, player: { name: 'Lukaku' }, type: 'Card', detail: 'Yellow Card', ...over })
const eventsProvider = (list) => ({ async fetchEvents() { return { response: list } } })

test('pollEvents baselines silently when events is null (no backfill spam)', async () => {
  await db.update(fixture).set({ events: null, score1: 0, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db)
  const emitted = []
  const n = await pollEvents(db, eventsProvider([goalRaw()]), ['9002'], xw, (e) => emitted.push(e))
  expect(n).toBe(0)
  expect(emitted).toEqual([])
  const [row] = await db.select().from(fixture).where(eq(fixture.id, '9002'))
  expect(row.events).toHaveLength(1) // baseline persisted, just not announced
})

test('pollEvents emits only newly-appearing goal/card events and carries the score on goals', async () => {
  await db.update(fixture).set({ events: [], score1: 1, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db)
  const emitted = []
  const n = await pollEvents(db, eventsProvider([goalRaw(), cardRaw(), { type: 'subst', team: { id: 3001 }, time: { elapsed: 70 }, player: { name: 'x' }, detail: 's' }]), ['9002'], xw, (e) => emitted.push(e))
  expect(n).toBe(2) // subst ignored
  expect(emitted).toContainEqual({ type: 'goal', fixtureId: '9002', teamCode: 'hr', player: 'Modric', assist: null, minute: 23, detail: 'Normal Goal', score: [1, 0] })
  expect(emitted).toContainEqual({ type: 'card', fixtureId: '9002', teamCode: 'be', player: 'Lukaku', minute: 30, card: 'yellow', detail: 'Yellow Card' })
})

test('pollEvents emits nothing when the event list is unchanged', async () => {
  await db.update(fixture).set({ events: [], score1: 0, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db)
  const provider = eventsProvider([goalRaw()])
  await pollEvents(db, provider, ['9002'], xw, () => {})   // first non-null poll: emits the goal
  const emitted = []
  const n = await pollEvents(db, provider, ['9002'], xw, (e) => emitted.push(e)) // same list again
  expect(n).toBe(0)
  expect(emitted).toEqual([])
})

test('pollEvents isolates a per-fixture fetch error', async () => {
  await db.update(fixture).set({ events: [], score1: 0, score2: 0 }).where(eq(fixture.id, '9002'))
  const xw = await resolveCrosswalk(db)
  const provider = { async fetchEvents() { throw new Error('boom') } }
  const n = await pollEvents(db, provider, ['9002'], xw, () => {})
  expect(n).toBe(0) // swallowed, no throw
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- live-poller`
Expected: FAIL — `pollEvents is not a function`.

- [ ] **Step 3: Implement `pollEvents`**

In `api/src/worker/live-poller.js`, update the import on line 3:

```js
import { mapLineups, mapEvents } from '../providers/mapping.js'
```

Append this function to the file:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- live-poller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/worker/live-poller.js api/test/live-poller.test.js
git commit -m "feat(api): pollEvents diffs and publishes new goal/card events"
```

---

### Task 5: Wire `pollEvents` into the worker tick

**Files:**
- Modify: `api/src/worker.js:5` (import) and `:36-39` (live branch)

This is runtime glue (the loop in `worker.js` has no unit test, consistent with the rest of the file). Verify by `npm run build` and a manual read; no new test.

- [ ] **Step 1: Import `pollEvents`**

In `api/src/worker.js`, update line 5:

```js
import { pollLive, pollEvents, pollLineups, fixturesToPoll, isLineupWindow } from './worker/live-poller.js'
```

Add `resolveCrosswalk` is already imported (line 6).

- [ ] **Step 2: Call `pollEvents` after `pollLive`**

In `api/src/worker.js`, replace the `if (liveIds.length) { ... }` block (lines 36-39) with:

```js
    if (liveIds.length) {
      const n = await pollLive(db, provider, liveIds, (e) => publish(db, e))
      if (n) console.log(`[live] updated ${n}`)
      // events poll AFTER scores, so a goal notification carries the just-updated score
      const e = await pollEvents(db, provider, liveIds, await resolveCrosswalk(db), (ev) => publish(db, ev))
      if (e) console.log(`[events] ${e} new`)
    }
```

- [ ] **Step 3: Verify it builds and the worker file parses**

Run: `node --check api/src/worker.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add api/src/worker.js
git commit -m "feat(api): poll fixture events each live tick after scores"
```

---

### Task 6: Expose `events` through serialize + assemble

**Files:**
- Modify: `api/src/serialize.js:13` (`serializeFixture`)
- Modify: `web/src/lib/assemble.js:90`
- Create: `api/test/serialize.test.js`
- Test: `web/src/lib/assemble.test.js`

- [ ] **Step 1: Write the failing backend test**

Create `api/test/serialize.test.js`:

```js
import { expect, test } from 'vitest'
import { serializeFixture } from '../src/serialize.js'

const base = {
  id: 'm1', group: 'A', matchday: 1, t1Code: 'ar', t2Code: 'mx',
  kickoffUtc: new Date('2026-06-13T06:30:00Z'), venue: 'V', city: 'C', status: 'live',
  score1: 1, score2: 0, minute: 63, probA: 50, probD: 25, probB: 25,
  lineups: null, stage: 'group', derby: false, doubleOwner: false,
}

test('serializeFixture passes events through', () => {
  const events = [{ id: 'x', type: 'goal', teamCode: 'ar', player: 'Messi', minute: 23, detail: 'Normal Goal', assist: null }]
  expect(serializeFixture({ ...base, events }).events).toEqual(events)
})

test('serializeFixture coerces null events to an empty array', () => {
  expect(serializeFixture({ ...base, events: null }).events).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- serialize`
Expected: FAIL — `expected undefined to deeply equal [...]`.

- [ ] **Step 3: Add `events` to `serializeFixture`**

In `api/src/serialize.js`, in `serializeFixture` (after the `lineups` line, line 13):

```js
    lineups: f.lineups ?? null,
    events: f.events ?? [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- serialize`
Expected: PASS.

- [ ] **Step 5: Write the failing frontend test**

In `web/src/lib/assemble.test.js`, add a test that an assembled fixture carries `events` (follow the file's existing `assembleSweep` usage — provide a single fixture with an `events` array and assert it survives onto `S.fixture(...)`):

```js
test('assembleSweep carries fixture events through (defaulting to [])', () => {
  const s = assembleSweep({
    bootstrap: { teams: [
      { code: 'ar', name: 'Argentina', group: 'A', pool: 'P', color: '#6cf', strength: 90 },
      { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
    ], people: [], ownership: {}, scoring: null },
    fixtures: [
      { id: 'm1', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-13T06:30:00Z', venue: 'V', city: 'C', status: 'live', score: [1, 0], minute: 63, prob: { a: 50, d: 25, b: 25 }, stage: 'group', events: [{ id: 'g1', type: 'goal', teamCode: 'ar', player: 'Messi', minute: 23, detail: 'Normal Goal', assist: null }] },
      { id: 'm2', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-14T06:30:00Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
    ],
    standings: {}, photos: [],
  })
  expect(s.fixture('m1').events).toHaveLength(1)
  expect(s.fixture('m1').events[0].player).toBe('Messi')
  expect(s.fixture('m2').events).toEqual([]) // missing → []
})
```

Check the top of `assemble.test.js` for how it imports/asserts (it likely calls `assembleSweep(...)` and reads the returned object's `.fixture(id)`); mirror that exact pattern. If the file uses `setSweepData` + `SWEEP`, use that instead.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -w web -- assemble`
Expected: FAIL — `events` is `undefined`.

- [ ] **Step 7: Add `events` to the assembled fixture**

In `web/src/lib/assemble.js`, in the `rawFixtures.map(...)` return (after the `lineups` line, line 90):

```js
      lineups: f.lineups ?? null, events: f.events ?? [], stage: f.stage, derby, doubleOwners,
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -w web -- assemble`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add api/src/serialize.js api/test/serialize.test.js web/src/lib/assemble.js web/src/lib/assemble.test.js
git commit -m "feat: expose fixture events through serialize and assemble"
```

---

### Task 7: `useEventStream` — route goal/card; stop inferring goal from score

**Files:**
- Modify: `web/src/hooks/useEventStream.js:35-55`
- Test: `web/src/hooks/useEventStream.test.jsx`

- [ ] **Step 1: Update the existing goal test + add goal/card tests**

In `web/src/hooks/useEventStream.test.jsx`, **replace** the existing test `'a goal (score rises while live) pushes a match-goal reaction for the scorer'` (lines 103-108) with its inverse, and add two new tests:

```js
test('a score rise no longer pushes a goal reaction (the events feed owns goals now)', () => {
  seedFixture('live', [0, 0])
  const { es } = setup()
  es.emit({ type: 'score', fixtureId: 'm1', status: 'live', score: [1, 0], minute: 20 })
  expect(pushNotification).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'goal' }))
})

test('a goal event pushes an enriched goal reaction with scorer, minute and score', () => {
  seedFixture('live', [0, 0])
  const { es } = setup()
  es.emit({ type: 'goal', fixtureId: 'm1', teamCode: 'ar', player: 'Messi', assist: 'Di Maria', minute: 23, detail: 'Penalty', score: [1, 0] })
  expect(pushNotification).toHaveBeenCalledWith({ kind: 'match', event: 'goal', fixtureId: 'm1', teamCode: 'ar', player: 'Messi', assist: 'Di Maria', minute: 23, detail: 'Penalty', score: [1, 0] })
})

test('a card event pushes a card reaction', () => {
  seedFixture('live', [0, 0])
  const { es } = setup()
  es.emit({ type: 'card', fixtureId: 'm1', teamCode: 'mx', player: 'Herrera', minute: 55, card: 'red', detail: 'Red Card' })
  expect(pushNotification).toHaveBeenCalledWith({ kind: 'match', event: 'card', fixtureId: 'm1', teamCode: 'mx', player: 'Herrera', minute: 55, card: 'red', detail: 'Red Card' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- useEventStream`
Expected: FAIL — the score-rise test still fires a goal (old code), and `goal`/`card` types are unhandled so `pushNotification` isn't called.

- [ ] **Step 3: Update the hook**

In `web/src/hooks/useEventStream.js`, in the `score` branch (lines 35-51), remove the goal-inference `else if` so only start/final remain:

```js
      } else if (ev.type === 'score') {
        // derive only kick-off / full-time by diffing against the fixture we still hold
        // (goals now arrive as their own `goal` event, with the real scorer)
        const prev = S.fixture(ev.fixtureId)
        if (prev) {
          if (prev.status !== 'live' && ev.status === 'live') {
            pushNotification({ kind: 'match', event: 'start', fixtureId: ev.fixtureId })
          } else if (prev.status === 'live' && ev.status === 'final') {
            pushNotification({ kind: 'match', event: 'final', fixtureId: ev.fixtureId, score: ev.score })
          }
        }
        qc.invalidateQueries({ queryKey: ['sweep'] })
      } else if (ev.type === 'goal') {
        pushNotification({ kind: 'match', event: 'goal', fixtureId: ev.fixtureId, teamCode: ev.teamCode, player: ev.player, assist: ev.assist, minute: ev.minute, detail: ev.detail, score: ev.score })
        qc.invalidateQueries({ queryKey: ['sweep'] })
      } else if (ev.type === 'card') {
        pushNotification({ kind: 'match', event: 'card', fixtureId: ev.fixtureId, teamCode: ev.teamCode, player: ev.player, minute: ev.minute, card: ev.card, detail: ev.detail })
        qc.invalidateQueries({ queryKey: ['sweep'] })
      } else if (ev.type === 'sync' || ev.type === 'photo-approved' || ev.type === 'photo-removed') {
```

(The `else if (ev.type === 'sync' ...)` line is the existing line 52 — keep it; the edit just inserts the two new branches before it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- useEventStream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useEventStream.js web/src/hooks/useEventStream.test.jsx
git commit -m "feat(web): route goal/card SSE events into notifications"
```

---

### Task 8: `FloatingReactions` — enrich goal, add card branch

**Files:**
- Modify: `web/src/FloatingReactions.jsx:64-79` (`MatchReaction`)
- Test: `web/src/FloatingReactions.test.jsx`

- [ ] **Step 1: Update the goal test + add a card test**

In `web/src/FloatingReactions.test.jsx`, **replace** the test `'renders a GOAL match notification with the scoring team and score'` (lines 47-53) with this enriched version and add a card test:

```js
test('renders a GOAL match notification with scorer, minute, score and a penalty tag', () => {
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ kind: 'match', event: 'goal', fixtureId: 'm1', teamCode: 'br', player: 'Neymar', assist: 'Vinicius', minute: 23, detail: 'Penalty', score: [1, 0] }) })
  expect(container.textContent).toContain('Goal!')
  expect(container.textContent).toContain('23')      // minute
  expect(container.textContent).toContain('Neymar')  // scorer name
  expect(container.textContent).toContain('1–0')     // score line
  expect(container.textContent).toContain('(P)')     // penalty tag from detail
})

test('renders a RED card match notification with player and minute', () => {
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ kind: 'match', event: 'card', fixtureId: 'm1', teamCode: 'br', player: 'Casemiro', minute: 55, card: 'red', detail: 'Red Card' }) })
  expect(container.textContent).toContain('Red card')
  expect(container.textContent).toContain('55')
  expect(container.textContent).toContain('Casemiro')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- FloatingReactions`
Expected: FAIL — goal text lacks the scorer/minute/tag; `card` event isn't rendered.

- [ ] **Step 3: Update `MatchReaction`**

In `web/src/FloatingReactions.jsx`, replace the `goal` branch (lines 67-79) with an enriched goal branch plus a new card branch:

```js
  if (it.event === "goal") {
    const scorer = S.team(it.teamCode);
    const tag = /penalty/i.test(it.detail || "") ? " (P)" : /own goal/i.test(it.detail || "") ? " (OG)" : "";
    return (
      <>
        <span className="reaction-badge">⚽</span>
        <div className="reaction-txt">
          <small>Goal!{it.minute != null ? ` · ${it.minute}'` : ""}</small>
          <b><img className="flag" src={S.flag(scorer.code, 40)} alt="" />{it.player || scorer.name}{tag}</b>
          <span className="reaction-mu">{a.name} {score} {b.name}</span>
        </div>
      </>
    );
  }
  if (it.event === "card") {
    const team = S.team(it.teamCode);
    const red = it.card === "red";
    return (
      <>
        <span className="reaction-badge">{red ? "🟥" : "🟨"}</span>
        <div className="reaction-txt">
          <small>{red ? "Red" : "Yellow"} card{it.minute != null ? ` · ${it.minute}'` : ""}</small>
          <b><img className="flag" src={S.flag(team.code, 40)} alt="" />{it.player || team.name}</b>
          <span className="reaction-mu">{a.name} v {b.name}</span>
        </div>
      </>
    );
  }
```

(`a`, `b`, and `score` are already computed at the top of `MatchReaction` on lines 65-66 — leave them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- FloatingReactions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/FloatingReactions.jsx web/src/FloatingReactions.test.jsx
git commit -m "feat(web): scorer/minute on goal popups + card notifications"
```

---

### Task 9: `MatchSheet` — persistent events timeline

**Files:**
- Modify: `web/src/screens-detail.jsx` (add `MatchTimeline`; render it in `MatchSheet` after the match-line, ~line 502)
- Test: `web/src/screens-detail.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/screens-detail.test.jsx`, extend the `sheetFixture` helper so callers can pass events, then add timeline tests. Change the `sheetFixture` signature (line 31) and the fixture object (line 40-44) to thread events:

```js
function sheetFixture(lineups, squads = {}, events = []) {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'P', color: '#d8334a', strength: 80, squad: squads.hr ?? null },
        { code: 'be', name: 'Belgium', group: 'L', pool: 'P', color: '#1f8a4c', strength: 82, squad: squads.be ?? null },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'be', ko: '2026-06-13T09:00:00Z',
      venue: 'V', city: 'C', status: 'live', score: [1, 0], minute: 30,
      prob: { a: 53, d: 26, b: 21 }, stage: 'group', lineups, events,
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
  return S.fixture('m1')
}
```

(Existing callers pass 1-2 args; the new `events` param defaults to `[]`, so they keep working — but note the fixture `status` is now `live` with a score, which the existing lineup tests tolerate since they assert on the Starting XI block, not the score.)

Add these tests:

```js
test('MatchSheet renders a timeline of goals and cards with player and minute', () => {
  const events = [
    { id: 'a', type: 'goal', teamCode: 'hr', player: 'Modric', assist: 'Perisic', minute: 23, detail: 'Normal Goal' },
    { id: 'b', type: 'card', teamCode: 'be', player: 'Lukaku', minute: 41, card: 'yellow', detail: 'Yellow Card' },
  ]
  const { getByText } = renderSheet(sheetFixture(null, {}, events))
  expect(getByText('Match events')).toBeTruthy()
  expect(getByText('Modric')).toBeTruthy()
  expect(getByText("23'")).toBeTruthy()
  expect(getByText('Lukaku')).toBeTruthy()
  expect(getByText("41'")).toBeTruthy()
})

test('MatchSheet shows no timeline block when there are no events', () => {
  const { queryByText } = renderSheet(sheetFixture(null, {}, []))
  expect(queryByText('Match events')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- screens-detail`
Expected: FAIL — "Match events" / "Modric" not found.

- [ ] **Step 3: Add the `MatchTimeline` component**

In `web/src/screens-detail.jsx`, add this component just above `export function MatchSheet` (line 466):

```jsx
function MatchTimeline({ f }) {
  const events = (f.events || []).slice().sort((x, y) => (x.minute ?? 0) - (y.minute ?? 0));
  if (events.length === 0) return null;
  const icon = (e) => e.type === "goal" ? "⚽" : e.card === "red" ? "🟥" : "🟨";
  const tag = (e) => /penalty/i.test(e.detail || "") ? " (P)" : /own goal/i.test(e.detail || "") ? " (OG)" : "";
  return (
    <>
      <div className="blocktitle" style={{ border: 0, padding: "2px 2px 10px" }}>Match events</div>
      <div className="block" style={{ padding: "8px 12px", marginBottom: 16 }}>
        {events.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0" }}>
            <span style={{ width: 34, color: "var(--muted2)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{e.minute}'</span>
            <span style={{ fontSize: 15 }}>{icon(e)}</span>
            <img className="flag" src={S.flag(e.teamCode, 40)} style={{ width: 18, height: 13 }} alt="" />
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>
              <b style={{ fontWeight: 700 }}>{e.player}</b>{tag(e)}
              {e.assist ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> ({e.assist})</span> : null}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Render it in `MatchSheet`**

In `web/src/screens-detail.jsx`, inside `MatchSheet`, immediately after the closing `</div>` of the `match-line` block (the `</div>` on line 502, just before the `{!showScore && f.hasOdds && (` block), insert:

```jsx
          <MatchTimeline f={f} />

```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w web -- screens-detail`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx
git commit -m "feat(web): match-sheet timeline of goals and cards"
```

---

### Task 10: Full verification

- [ ] **Step 1: Run the entire backend suite** (Docker must be running)

Run: `npm run test`
Expected: all api tests PASS (existing + new schema/mapping/provider/live-poller/serialize tests).

- [ ] **Step 2: Run the entire web suite**

Run: `npm run test -w web`
Expected: all web tests PASS.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: web build succeeds, no errors.

- [ ] **Step 4: Final commit (if anything outstanding)**

```bash
git status   # should be clean; if not, review and commit
```

---

## Self-Review Notes

- **Spec coverage:** goals+cards capture (Tasks 2-4) · jsonb storage on fixture (Task 1) · provider `fetchEvents` (Task 3) · `pollEvents` diff/emit/silent-baseline (Task 4) · score-diff reconciliation — drops inferred goal (Task 7) · enriched notifications + card branch (Tasks 7-8) · match-sheet timeline (Task 9) · serialize/assemble exposure (Task 6). All spec sections map to a task.
- **Deviation from spec — timeline empty state:** the spec said "Empty state when none"; this plan hides the timeline block entirely when there are no events (Task 9 returns `null`), matching the codebase's pattern of conditionally-rendered blocks (odds, Starting XI). The "no events" case is realized by omission, asserted by the second Task 9 test.
- **Own-goal attribution** is intentionally simple: `teamCode` is whatever API-Football attaches to the event; the match score on the popup stays correct and an "(OG)" tag marks it. Noted in the spec as accepted.
- **Type consistency:** event shape `{ id, type, teamCode, player, minute, detail, assist?, card? }` is identical across `mapEvents` (Task 2), `pollEvents` persistence (Task 4), serialize/assemble (Task 6), and both render sites (Tasks 8-9). SSE payloads `{type:'goal', ..., score}` and `{type:'card', ...}` match between `pollEvents` (Task 4) and `useEventStream` (Task 7).
- **Noise tradeoff** (every yellow notifies) is accepted per spec; the timeline is the durable record.
