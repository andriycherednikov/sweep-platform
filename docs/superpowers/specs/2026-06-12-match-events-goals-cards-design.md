# Match events: goal scorers & cards — design

**Status:** approved (brainstorm) · **Date:** 2026-06-12

## Problem

Today the live-match notification system is **score-diffing only**. The worker stores
just `score1`, `score2`, `status`, `minute` per fixture; the frontend infers
"goal / kick-off / full-time" by comparing the new score against the cached fixture
(`web/src/hooks/useEventStream.js`, `web/src/FloatingReactions.jsx`). Consequences:

- A "goal" notification names only the **scoring team** (inferred from which number went
  up) — no scorer, no minute.
- **Cards are invisible.** Yellow/red cards don't change the score, so the score-diff
  approach can't see them at all.

We want richer match events: on a goal, show **who** scored and **when**; and surface
**yellow/red cards** in the floating notifications. Details should also persist in a
chronological timeline on the match detail sheet (notifications are transient, ~4.5s).

## Scope

In scope:
- **Goals** — scorer name, minute, and goal kind (normal / penalty / own goal) from the
  API `detail` label; assist when present.
- **Cards** — yellow & red, with player and minute.
- **Floating notifications** enriched for goals and added for cards.
- **Match-sheet timeline** — persistent chronological list of goals + cards.

Out of scope (YAGNI): substitutions, VAR, missed penalties, and any other event type.
The provider mapper drops everything except Goal and Card.

## Architecture

A new data path: fetch the per-fixture event list from API-Football, store it on the
fixture, emit only newly-seen events over SSE, render them.

### Data model

New column on the existing `fixture` table (mirrors the existing `lineups` jsonb
precedent — `api/src/db/schema.js`):

```
events jsonb   -- nullable, NO default
```

`null` is a deliberate sentinel meaning *never polled* — the worker baselines such a
fixture silently (no notification backfill on a mid-match restart). An array (incl. `[]`)
means *polled at least once* → diff & emit. The serialize/assemble layers coerce
`null → []` so the frontend always receives an array.

Each element:

```js
{
  id,                 // stable composite, see below
  type,               // 'goal' | 'card'
  teamCode,           // our team code (resolved via team_crosswalk)
  player,             // scorer / carded player name
  minute,             // time.elapsed (+ extra when present), integer-ish
  assist,             // optional — goals only, when API provides it
  detail,             // raw API label: "Normal Goal" | "Penalty" | "Own Goal" |
                      //                "Yellow Card" | "Red Card" | "Second Yellow card"
  card,               // optional — cards only: 'yellow' | 'red'
}
```

- **`id`** is a deterministic composite of the event's identifying fields
  (`elapsed`-`extra`-`teamCode`-`player`-`type`-`detail`). The API has no event id, and
  the worker needs to diff fetched-vs-stored to find genuinely new events without a DB
  sequence. The composite is stable across polls of the same event.
- **`card`** is derived from `detail`: "Red Card" / "Second Yellow card" → `'red'`,
  "Yellow Card" → `'yellow'`.
- Stored order: by `minute`, then by fetch order (stable).

### Provider (`api/src/providers/`)

- `fetchEvents(fixtureId)` → `GET /fixtures/events?fixture=<id>` in
  `api-football-provider.js`. Add `fetchEvents` to the typedef in `football-provider.js`.
- `mapEvents(raw, crosswalk)` in `mapping.js`:
  - Keep only `type === 'Goal'` and `type === 'Card'`; drop `subst`, `Var`, etc.
  - `time.elapsed` (+ `time.extra` when present) → `minute`.
  - `team.id` → our `teamCode` via the existing crosswalk lookup (same mechanism
    `mapFixture` uses for home/away provider ids).
  - `player.name` → `player`; `assist.name` → `assist` (null-safe).
  - `detail` → `detail`; for cards, derive `card` from `detail`.
  - Compute the composite `id`.

### Worker — `pollEvents` (`api/src/worker/live-poller.js`, `api/src/worker.js`)

Sibling of `pollLive`, run each 60s tick over the **same live-window fixture id set**
(`live-poller.js` already computes `fixturesToPoll`). Cards don't change the score, so
events are polled on their own cadence — **not** gated on a score change.

Per fixture (each wrapped in try/catch for error isolation, like the existing pollers):

1. `fetchEvents` → `mapEvents` → new list.
2. Compare against stored `fixture.events` by `id`.
3. If unchanged, skip.
4. If changed, persist the full new list to `fixture.events`, then for each **new** event
   (id not previously stored) `publish({ type, fixtureId, ...detail })`.

**Silent first poll:** if the stored list was empty/null and the game is already live when
the worker first sees it (e.g. worker restart mid-match), persist without emitting — no
backfill spam. Notifications only fire for events that appear *after* we have a baseline.

### SSE + score-diff reconciliation

The worker emits two new event types over the existing bus → `pg_notify` → SSE path
(`api/src/events/*`, `api/src/routes/stream.js`):

```js
{ type:'goal', fixtureId, teamCode, player, assist?, minute, detail }
{ type:'card', fixtureId, teamCode, player, minute, card, detail }
```

The existing `score` event (from `pollLive`) **keeps** ownership of score numbers,
kick-off (`start`), and full-time (`final`). It **stops** emitting its inferred `goal`
popup — the events feed now owns goal popups with the real scorer. This avoids
double-firing. (Score numbers shown in the goal popup come from the fixture cache, which
the `score` event still refreshes.)

### Frontend

- **`web/src/hooks/useEventStream.js`**
  - `score` branch: keep `start` / `final` / `invalidateQueries`; **remove** the
    `na > oa || nb > ob` → `event:'goal'` push.
  - Add `goal` and `card` branches → `pushNotification({ kind:'match', event:'goal'|'card', ... })`
    with the full detail, then invalidate so the timeline/score refresh.
- **`web/src/FloatingReactions.jsx`** (`MatchReaction`)
  - `goal` branch enriched: ⚽ "Goal! · {minute}'", scorer name + team flag,
    `a {score} b`; note penalty/own-goal from `detail`.
  - New `card` branch: 🟨 / 🟥, "{Yellow|Red} card · {minute}'", player + team.
- **`web/src/styles.css`** — card badge styling (yellow/red) reusing the
  `.reaction-badge` structure.
- **Match-sheet timeline** — render `fixture.events` (already carried in the cached
  fixture once `serialize` includes the column) as a chronological list on the match
  detail sheet: each row `minute' · icon · player · (assist)` / card colour. Empty state
  when no events.
- **`api/src/.../serialize.js`** — include the `events` column in the fixture payload.

## Testing (TDD)

- **`mapEvents`** — filters to goal/card only; maps Normal Goal / Penalty / Own Goal /
  Yellow / Red / Second Yellow→red; crosswalk team resolution; null-safe assist; composite
  id stability.
- **`pollEvents`** — diff emits only new events; silent first poll (no backfill);
  persistence of full list; per-fixture error isolation; no emit when unchanged.
- **Frontend** — `useEventStream` routes `goal`/`card` → notifications and no longer
  double-fires goal from the `score` branch; `MatchReaction` renders goal (scorer/minute)
  and card (yellow/red) variants; timeline renders rows + empty state.

## Migration

One Drizzle migration in `api/migrations/` adding
`events jsonb not null default '[]'` to `fixture` (via `db:generate` from the updated
schema).

## Cost note

`/fixtures/events` is one call per live fixture per 60s tick. The World Cup has at most a
handful of simultaneous matches, well within the API-Football Pro budget. Polling is
confined to the existing live window.

## Noise tradeoff (accepted)

Every yellow card floats a notification; a chippy match can produce 6–8. Accepted: the
novelty is part of the fun for a ~45-person sweep, and the match-sheet timeline is the
durable record while notifications are the transient highlight.
