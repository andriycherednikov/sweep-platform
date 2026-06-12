# Match reminders via Web Push — design

**Date:** 2026-06-12
**Status:** Approved, ready to plan
**Feature:** Per-game "notify me before the game" reminders delivered as true Web Push
notifications that fire even when the app is closed.

## Goal

Let a participant tap a bell on any match, choose how long before kickoff to be
reminded (15 / 30 / 60 minutes, or at kickoff), and receive a system notification at
that time — even with the app fully closed. Tapping the notification opens the app.

## Decisions (from brainstorming)

- **Delivery:** True Web Push (service worker + Push API + VAPID + backend sender), not
  app-open-only local notifications. Works on Android in-browser and installed; on iOS
  only for the **installed** PWA (16.4+) — the install flow shipped earlier enables this.
- **Scope of games:** Per-game opt-in via a bell control. No auto-subscribe by team.
- **Lead time:** User picks per game — 15, 30, 60 minutes, or at kickoff (0).
- **Identity:** Per **device**, matching the app's existing per-device identity. Push
  endpoints are per-device anyway. `person_id` is recorded for insight but does not drive
  sending.
- **Tap target:** Focus/open the app at `/`. Deep-linking to the specific match sheet is
  out of scope for v1 (the match modal is not URL-addressable yet).

## Non-goals (v1)

- Auto-reminders by drawn team / watched players (per-game opt-in only).
- Deep-link into the specific match on notification tap.
- Reminders for live events (goals, full-time) — this is pre-kickoff only.
- A global/profile lead-time preference — lead time is chosen per game.
- Email/SMS fallback.

## Architecture

Approach: **reminder rows + the existing worker tick.** Each opt-in is a row; the
worker's existing 60-second `setInterval` tick scans for reminders coming due and sends
them. A `sent_at` flag guarantees exactly-once delivery and survives restarts.

```
Match-card bell ─tap→ request Notification permission (first time only)
   → register service worker → PushManager.subscribe(VAPID public key)
   → POST /api/push/subscribe  { endpoint, keys:{p256dh, auth}, deviceId, personId? }
   → POST /api/reminders       { deviceId, fixtureId, leadMinutes }

Worker 60s tick (already running):
   dueReminders(now) = reminders WHERE sent_at IS NULL
                       AND (fixture.kickoff_utc - leadMinutes) ∈ [now - 5m, now + 60s)
   for each → web-push.sendNotification(subscription, payload) → set sent_at = now
   on 404/410 (expired endpoint) → delete that push_subscription (+ its reminders)

Service worker:
   'push'            → showNotification(title, { body, icon, data:{url} })
   'notificationclick' → focus an existing client or openWindow('/')
```

### Why this fits the codebase

- The worker (`api/src/worker.js`) already runs a 60s tick over fixtures — the due-reminder
  scan is one more query in the same loop.
- Fixtures already carry `kickoff_utc` (`api/src/db/schema.js`).
- The event bus / SSE is unaffected; reminders are a separate delivery channel.

## Data model (two new tables, `api/src/db/schema.js`)

### `push_subscription`
| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `device_id` | text, not null | the app's per-device id |
| `person_id` | text, nullable | recorded for insight only |
| `endpoint` | text, not null, **unique** | the push endpoint URL |
| `p256dh` | text, not null | subscription key |
| `auth` | text, not null | subscription key |
| `created_at` | timestamptz, default now | |

One row per browser/device. Re-subscribing with the same endpoint upserts.

### `reminder`
| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `device_id` | text, not null | which device opted in |
| `fixture_id` | text, not null | FK-ish to `fixture.id` |
| `lead_minutes` | integer, not null | 15 / 30 / 60 / 0 |
| `sent_at` | timestamptz, nullable | null = pending; set when sent |
| `created_at` | timestamptz, default now | |

**Unique on `(device_id, fixture_id)`** — toggling the bell re-points an existing row
(changing `lead_minutes`, clearing `sent_at`); turning the bell off deletes the row.

When a reminder's `lead_minutes` changes, `sent_at` resets to null so the new time fires.

## API (Fastify, `api/src/routes/`)

- `GET  /api/push/key` → `{ publicKey }` (VAPID public key for the client to subscribe).
- `POST /api/push/subscribe` → upsert a `push_subscription` by `endpoint`. Body:
  `{ endpoint, keys:{p256dh, auth}, deviceId, personId? }`.
- `POST /api/push/unsubscribe` → delete by `endpoint` (best-effort; also pruned lazily on
  send failure).
- `GET  /api/reminders?deviceId=…` → reminders for a device (so the UI can render bell
  state on load). Returns `[{ fixtureId, leadMinutes, sentAt }]`.
- `POST /api/reminders` → upsert `{ deviceId, fixtureId, leadMinutes }` on
  `(device_id, fixture_id)`; resets `sent_at`.
- `DELETE /api/reminders` → remove `{ deviceId, fixtureId }`.

No admin auth — these are participant actions keyed by the device's own id, consistent with
the existing watch/support social endpoints.

## Worker sender (`api/src/worker/reminders.js`)

- `dueReminders(db, now)` — query returning pending reminders whose
  `kickoff_utc - lead_minutes` falls in `[now - recoveryMargin, now + tickWindow)`, joined to
  their fixture (for title/body) and subscription (for endpoint/keys). `tickWindow` = 60s to
  match the loop; `recoveryMargin` = 5m catches reminders missed during brief downtime — the
  `sent_at` guard keeps them exactly-once. A reminder still pending more than `recoveryMargin`
  past its due time is considered stale and skipped (the game has effectively started).
- `sendDueReminders(db, webpush, now)` — loop: build payload, `sendNotification`, set
  `sent_at`; on `statusCode` 404/410 delete the subscription and its reminders. Returns a
  count for logging. Called once per tick in `worker.js`, after the live poll.
- Payload: `{ title: "<A> vs <B> kicks off in <N> min" (or "is kicking off"), body:
  "<venue> · Group <G>", icon: "/web-app-manifest-192x192.png", data:{ url: "/" } }`.

## Service worker (`web/public/sw.js`) + registration

- New `web/public/sw.js` (plain JS, served at site root so its scope is `/`):
  - `push` → `event.waitUntil(self.registration.showNotification(title, options))`.
  - `notificationclick` → close, then focus an open client or `clients.openWindow('/')`.
- Registered from the app once on load (only where `serviceWorker` + `PushManager` exist).
  This is the app's first service worker; it is intentionally **notifications-only** — no
  offline caching — to avoid stale-asset complexity. (If we later want offline, that's a
  separate spec.)

## Frontend (`web/src/`)

- **Shared push store** (`hooks/usePush.js`), same module-singleton + `useSyncExternalStore`
  pattern as `useInstallPrompt`: tracks `supported`, `permission`, `subscribed`, and the set
  of reminders for this device (loaded from `GET /api/reminders`). Exposes
  `ensureSubscribed()`, `setReminder(fixtureId, leadMinutes)`, `clearReminder(fixtureId)`.
- **Bell control** (`ReminderBell.jsx`) on the match card and in the match sheet:
  - Hidden/disabled when push is unsupported. On iOS-Safari-not-installed, show the same
    "install first" nudge used by the install flow.
  - Off (outline bell) → tap → run permission + subscribe if needed → show a small menu
    (15 / 30 / 60 min / At kickoff) → on pick, `setReminder` and fill the bell.
  - On (filled bell, shows chosen lead) → tap → remove (`clearReminder`).
  - Past/kicked-off fixtures: bell hidden.
- Device id: reuse the existing per-device id used by the social layer (watch/support); do
  not invent a new one.

## Configuration / env

| var | notes |
|---|---|
| `VAPID_PUBLIC_KEY` | from `web-push generate-vapid-keys`; also surfaced to the client |
| `VAPID_PRIVATE_KEY` | server-only secret |
| `VAPID_SUBJECT` | `mailto:` contact required by the push spec |

Generated once by a human; added to `.env` / `.env.example` (placeholder only) and the prod
compose env. The site never exposes the private key.

## Dependencies

- **`web-push`** (npm) in the `api` workspace — the canonical library; handles VAPID auth and
  payload encryption. No hand-rolled crypto.

## Testing (TDD, Vitest + Testcontainers Postgres)

- **API:** subscribe upsert by endpoint; unsubscribe; reminder upsert/dedupe on
  `(device, fixture)`; reminder delete; `GET /api/reminders` shape; `lead_minutes` change
  resets `sent_at`.
- **Worker:** `dueReminders(now)` window correctness (in-window unsent included; already-sent
  excluded; out-of-window excluded; downtime-recovery margin); `sendDueReminders` with
  `web-push` mocked — sends + marks `sent_at`, skips sent, prunes subscription on 410.
- **Frontend:** `ReminderBell` state machine (off → permission → lead-time menu → on → off)
  with Notification/PushManager/fetch mocked; unsupported-platform rendering.
- Service worker `push`/`notificationclick` handlers: light unit coverage with mocked
  `self.registration` / `clients` (logic only; real delivery verified manually on device).

## Manual verification (can't be unit-tested)

- Real push delivery end-to-end on Android (installed + in-browser) and on an **installed**
  iOS PWA: set a reminder for a near-future fixture, fully close the app, confirm the
  notification arrives and tapping it opens the app.

## Rollout notes

- iOS requires the installed PWA; surface the install nudge where push is unsupported.
- Existing installed PWAs need no reinstall for push (the service worker registers on next
  load), but iOS users must be installed for permission to be grantable.
