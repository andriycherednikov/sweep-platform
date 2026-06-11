# Floating reactions — design

**Date:** 2026-06-11
**Status:** approved, ready to implement

## Goal

Show everyone an ambient, real-time "floating reaction" when someone backs a team
to win (the crowd-pick / `support` action). First of a small, general
notification system — later triggers (photo approved, watching, goals) are just
another `pushNotification(...)` call.

## Behaviour (decided)

- **Trigger:** the `support` action, on **pick & switch only** (not on remove).
- **Audience:** everyone, **including the actor** (no filtering).
- **Placement/motion:** each reaction **rises from the bottom and fades out around
  mid-screen** (~4.5s), then removes itself. Ambient and non-interactive
  (`pointer-events:none`), with a small random horizontal offset so simultaneous
  reactions don't perfectly overlap.
- **Content:** avatar + "{name} is backing / switched to" + flag + team name +
  matchup, e.g. `(HW) Hugo is backing 🇧🇷 Brazil · BRA v MAR`.
- **Copy:** `pick` → "is backing", `switch` → "switched to".

## Architecture

### Backend — enrich one event (`api/src/routes/social.js`)
`POST /api/support` already publishes `{ type:'support', fixtureId }`. Enrich to:

```js
{ type:'support', fixtureId, personId, supporting, action }
```

- `supporting` = new `teamCode`, or `null` on remove.
- `action` = `'switch'` when there was a different prior pick, else `'pick'`.
- Backward-compatible: still drives the existing `social` query refetch.

### Frontend — one SSE connection, routed
No new `EventSource`. The existing `useEventStream` hook, on a `support` event
**with non-null `supporting`**, calls a tiny pub/sub.

- **`web/src/notifications.js`** — `pushNotification(n)`, `onNotification(fn)`
  (same listener pattern as `social.js`). Each `n` = `{ id, personId, teamCode,
  fixtureId, action }`.
- **`useEventStream`** — still invalidates `social` on `support`; additionally,
  if `ev.supporting`, `pushNotification({ id, personId: ev.personId, teamCode:
  ev.supporting, fixtureId: ev.fixtureId, action: ev.action })`.

### Frontend — `FloatingReactions` component (mounted once at app root)
- Subscribes via `onNotification`; holds an array of in-flight reactions.
- Resolves display from already-loaded sweep data: person (avatar+name) via
  `S.peopleById`, team (flag+name) via `S.team`, fixture (matchup) via
  `S.fixture`. If any can't be resolved, the reaction is **skipped**.
- Renders a compact card animated by a CSS `riseFade` keyframe; removes each
  entry after the animation (~4.5s) via a timer.
- `position:fixed`, bottom-center, `pointer-events:none`, random horizontal
  offset per card.

## Testing

- **Backend:** `support` route emits the enriched event incl. `personId`,
  `supporting`, `action` (extend `api/test/social.test.js`).
- **Frontend:**
  - `notifications.js` emitter: push → subscriber receives; unsubscribe works.
  - `useEventStream`: a `support` event with `supporting` pushes a notification;
    a remove (`supporting:null`) does not.
  - `FloatingReactions`: renders a card from a pushed notification and clears it
    after the timeout (fake timers).

## Out of scope (for now)

Persistence/history (ephemeral only), audience filtering, other trigger types,
rate-limiting/throttling.
