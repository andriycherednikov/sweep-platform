# The Sweep — Backend & "Make It Functional" Design

**Date:** 2026-06-09
**Status:** Approved design (pre-implementation)
**Author:** brainstormed with the team

---

## 1. Context & goal

The Sweep is a mobile-first (and responsive desktop) web app for a local community's
FIFA World Cup 2026 sweep (~45 participants). The **frontend is built and verified** as
a Vite + React 18 SPA (Matchday design), but every piece of data is currently a
deterministic placeholder baked into `web/src/data.js`, and the social layer
(identity, "who's watching", team backing) lives in `localStorage` — so it is **not
actually shared** between people.

This design covers everything required to turn that mockup into a **real, deployed,
functioning app** for the tournament.

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| **Intent** | Ship it for real — runs the 2026 World Cup for the real ~45-person group, real pot, low-touch for ~6 weeks. |
| **Identity** | Light — viewers pick themselves and the choice is remembered per device; no impersonation protection (low-stakes social actions). Admin gets a real server-side passcode. |
| **Football data** | API-Football **Pro** (~$19/mo for the tournament window) behind a provider adapter. Live scores + official predictions + current-season coverage. |
| **Hosting** | Self-hosted, containerized. Local Postgres, Docker, independent Caddy container in prod. |
| **API/worker language** | Node + Fastify (one language across the stack; reuse existing JS data/seed logic). |
| **Photo storage** | Filesystem volume, served as static files by Caddy. |
| **Realtime** | SSE push from the API for the live social layer + live scores. |
| **DB access** | Drizzle ORM + Drizzle Kit migrations (lightweight; revisit if Prisma/raw SQL preferred). |
| **Scoring rule** | Own the winner / runner-up / 3rd place; all co-owners win outright (a "still alive / in the money" tracker, stored as config). |

---

## 2. Architecture & containers

Five containers orchestrated by Docker Compose:

```
                    ┌─────────────────────────────┐
   Internet ─443──▶ │ caddy  (TLS, reverse proxy)  │
                    │  • serves SPA static build   │
                    │  • /api/*   → api:3000        │
                    │  • /photos/* → photos volume │ (approved only)
                    └───────────┬─────────────────┘
                                │
                    ┌───────────▼─────────┐     ┌──────────────────┐
                    │ api (Node/Fastify)  │     │ worker (Node)    │
                    │  REST + SSE + upload │     │  baseline sync   │
                    │  reads/writes PG     │     │  + live poller   │
                    └───────┬─────────────┘     └────────┬─────────┘
                            │                            │
                    ┌───────▼────────────────────────────▼─────┐
                    │ postgres   (volume: pgdata)               │
                    └───────────────────────────────────────────┘
   volumes: pgdata (db), photos (uploaded images, shared api↔caddy)
   one-shot: migrate (runs Drizzle migrations on deploy, then exits)
```

**Principles**

- **The SPA never calls API-Football.** Only the worker does; the site reads our Postgres
  cache through the api. The cache is the contract — an API outage never takes the site down.
- **Caddy serves the SPA build + approved photos** as static files and reverse-proxies
  `/api/*`. Pending photos live in a path the api can read but Caddy will not serve, so
  nothing unapproved is ever publicly reachable.
- **worker** shares the api image (same adapter/db code), different entrypoint.
- **Dev mode**: `docker-compose.dev.yml` runs Postgres + api; Vite runs locally with HMR,
  proxying `/api` to the api container.

---

## 3. Data model (Postgres, via Drizzle)

**Reference / sweep data** (seeded once from `data.js`, admin-editable):
- `person` — `id`, `name`, `short`, `initials`, `av_color`, `avatar_path?` (approved
  profile image; null → fall back to the initials + `av_color` avatar)
- `team` — `code` (PK), `name`, `group`, `pool`, `color`, `strength`, `flag_code`
- `ownership` — `person_id` × `team_code` (many-to-many)
- `scoring_config` — single row: `rule = 'top3'`, `co_owners = 'all_win'`
- `team_crosswalk` — `team_code` ↔ API-Football team id (seeded once; asserted each sync)

**Synced from API-Football** (worker writes, site reads):
- `fixture` — `id`, `group`, `matchday`, `t1_code`, `t2_code`, `kickoff_utc`, `venue`,
  `city`, `status` (upcoming/live/final), `score1`, `score2`, `minute`, `prob_a/d/b`,
  `stage` (group/knockout), `derby` (computed), `double_owner` (computed), `updated_at`
- `standing` — `team_code`, `played`, `win`, `draw`, `loss`, `gf`, `ga`, `pts`, `updated_at`
- `sync_log` — `id`, `ran_at`, `source`, `kind` (baseline/live), `status`, `counts`, `error`

**Social + photos** (viewer writes via light identity):
- `watch` — (`fixture_id`, `person_id`) unique — who's watching
- `support` — (`fixture_id`, `person_id`) → `team_code`, unique per person per fixture — who's backing
- `photo` — `id`, `kind` (`fan` | `profile`), `uploader_name`, `person_id?`,
  `team_code?`, `file_path`, `thumb_path`, `caption`, `status`
  (pending/approved/rejected/removed), `created_at`, `moderated_at`
  - `kind='fan'` → tagged to a `team_code` (current behaviour).
  - `kind='profile'` → the subject is `person_id` (you upload your own); `team_code` null.
    On approval the file becomes the person's `avatar_path` and any prior approved profile
    photo for that person is superseded (status → `removed`).

**Derived at read-time (no table):**
- Derby / double-owner flags are computed in the worker and stored on `fixture`.
- Standings are stored **as API-Football provides them** (official tiebreakers) — not
  recomputed client-side.
- "In the money" / People ranking is computed from `ownership` + `standing` +
  `scoring_config` (owners of teams still alive for top-3).

---

## 4. Football data pull (worker)

**Provider adapter.** A `FootballProvider` interface with one implementation,
`ApiFootballProvider`. The worker depends on the interface — swapping sources or
injecting recorded fixtures for tests needs no worker changes.

```
interface FootballProvider {
  fetchFixtures(season): RawFixture[]      // /fixtures?league=1&season=2026
  fetchStandings(season): RawStanding[]    // /standings
  fetchPredictions(fixtureId): Prob        // /predictions
  fetchLive(): RawLiveFixture[]            // /fixtures?live=all  (all in-play in ONE call)
}
```

**Two cadences** (Pro's 7,500/day cap gives ~10× headroom; ~750 calls on a heavy match day):

1. **Baseline sync** — a few times a day: fixtures + standings + predictions for upcoming
   fixtures (predictions cached per fixture). Upserts are idempotent; recompute
   derby/double-owner flags; write a `sync_log` row.
2. **Live poller** — `GET /fixtures?live=all` every 60s, **only activated around known
   kickoff windows** (the worker knows the schedule and idles when nothing is on). Each
   poll updates scores/minute in Postgres → fires SSE `score` events → the `63'` ticks
   live on every client.

**ID mapping.** Provider team ids → our `team.code` via `team_crosswalk`, asserted each
run so a mismatch **fails loudly** (logged, surfaced) rather than silently dropping a match.

**Scheduling.** Long-running worker container with an internal scheduler (`node-cron`) so
timing lives in code and survives restarts. `POST /api/admin/sync` forces a manual refresh.

**Failure handling — the cache is the contract.**
- Any pull failure → log to `sync_log`, leave last-good data untouched, site keeps serving.
- If the newest successful baseline sync is older than **18h**, the api reports
  `stale: true` and the UI shows a quiet "scores may be delayed" banner.
- Per-endpoint retry with backoff. Predictions are best-effort — a missing prediction just
  omits the win-% bar, never breaks a card.

---

## 5. Frontend integration & live social layer

**Leverage the existing structure.** Every screen consumes `S.*` (the data object) or the
social functions. We replace *what is behind* those; the ~1,700 lines of components/screens
barely change.

**Data layer** — replace static `data.js` with a fetch layer using **TanStack Query**:
- `GET /api/bootstrap` → teams, people, ownership, scoring config (slow-changing; long cache)
- `GET /api/fixtures` (+ server-side `?person=` / `?team=` filters), `/api/fixtures/:id`
- `GET /api/standings`, `/api/people`, `/api/teams/:code`
- `GET /api/photos?team=` (approved only)
- A thin client assembles the same `SWEEP`-shaped object the components expect.
- Sydney-time formatting helpers stay client-side (pure functions, already written).

**SSE** — one endpoint `GET /api/stream` pushes: `score`, `watch`, `support`,
`photo-approved`, `sync` (freshness). A `useEventStream` hook subscribes once at mount and
invalidates the relevant TanStack Query caches per event — live goals and others' actions
appear within ~1s, no refresh. Auto-reconnect with backoff + catch-up refetch.

**`social.js` → API + SSE:**
- Identity (`me`) stays in `localStorage`, now sent to the server on writes.
- `toggleWatch` / `setSupport` → `POST /api/watch` / `POST /api/support` with
  `{fixtureId, personId}`. **Optimistic** update, confirmed via SSE echo, rolled back on error.
- `watchersOf` / `supportOf` read from server state (seeded into Query, kept live by SSE).
- This fixes the "biggest lie" — watching/backing become genuinely shared across all ~45 people.

**Avatars & profile photos:**
- The `Av`/`AvStack` components render the person's `avatar_path` image when present, falling
  back to the existing initials + `av_color` chip otherwise. Single-component change,
  reflected everywhere avatars appear (owners, watchers, backers, identity chip, people list).
- The identity ("Who are you?") sheet and the current user's Person detail gain an **"Upload
  profile photo"** action, reusing the existing upload sheet with `kind='profile'`. It enters
  the admin queue; the uploader sees an "awaiting approval" state while others keep seeing the
  initials avatar until it's approved.

**Loading & error states** (new, since data is remote):
- Shell renders instantly; cards show shimmer on first load.
- Per-query error → inline retry; global "scores may be delayed" banner when `stale:true`.
- Stream-down → last-fetched data stays; subtle "reconnecting…" indicator.

---

## 6. Photos & admin (write paths)

**Photo upload** — `POST /api/photos` (multipart) `{kind, uploaderName, personId?, teamCode?, file}`:
- `kind='fan'` → tagged to `teamCode` (fan photo). `kind='profile'` → tagged to the
  uploader's own `personId` (profile picture); `teamCode` omitted.
- Validate: type allowlist (jpg/png/webp), 8 MB cap. Profile uploads are cropped/resized to
  a square avatar; fan photos keep their aspect ratio.
- Server **re-encodes, strips EXIF**, generates a thumbnail.
- Stored to the **pending** path (not web-served), status `pending`. **Nothing is public
  until approved** — the key safeguard for both kinds, since kids may appear.
- **One pending upload per person, per kind**, enforced server-side (a pending profile photo
  doesn't block a fan-photo upload, and vice-versa).
- Note: under light identity, someone could upload a profile photo for a name they picked;
  admin approval is the safeguard that catches misuse.

**Admin** (server-side, cookie-gated):
- `POST /api/admin/login {passcode}` → verify against `ADMIN_PASSCODE` (bcrypt-hashed env
  var) → set **httpOnly, signed, short-TTL cookie**. The client-side `2026` check is removed.
- All admin routes verify the cookie; login attempts rate-limited.
- `POST /api/admin/photos/:id {approve|reject|remove}` — the **same queue moderates both
  fan and profile photos** (shown tagged "Fan · {team}" or "Profile · {person}"). **Approve**
  moves the file to the web-served path + flips status; for `kind='profile'` it also sets the
  person's `avatar_path` (superseding any previous one). SSE `photo-approved` → fan photos
  appear live on team page + home banner; approved profile avatars update live everywhere the
  person's avatar renders. **Remove** on an active profile reverts that person to their
  initials avatar.
- Admin write access also to: fixture overrides (correct score/status), sweep data
  (ownership, people, scoring config), and `POST /api/admin/sync`.

---

## 7. Dev, deploy, testing, errors

**Repo layout** (monorepo, npm workspaces):
```
web/    existing Vite app (becomes a workspace)
api/    Fastify app + worker; shared db/ (Drizzle schema+migrations) + providers/
infra/  Caddyfile, docker-compose.yml, docker-compose.dev.yml
docs/   this spec + plan
```

**Deploy:**
- `docker-compose.yml` (prod): caddy + api + worker + postgres + one-shot `migrate`.
  Caddy auto-TLS from the domain.
- `docker-compose.dev.yml`: postgres + api; Vite local with HMR proxying `/api`.
- Config via `.env`: DB creds, `API_FOOTBALL_KEY`, `ADMIN_PASSCODE`, `SESSION_SECRET`,
  `PHOTOS_DIR`, `SITE_ORIGIN`.

**Testing:**
- **Unit:** API-Football adapter mapping (recorded sample JSON), derby/scoring/"in-the-money"
  logic, time-zone formatting, photo validation.
- **Integration:** API routes against a throwaway Postgres (Testcontainers) — watch/support
  idempotency, upload→moderation→public flow, admin auth, stale-flag behavior.
- **E2E smoke:** Playwright happy paths (harness pattern already established).
- **Worker:** idempotent upserts (re-running changes nothing); failure leaves last-good cache.

**Error handling (consolidated):**
- Worker failure → `sync_log`, serve last-good; `stale:true` after 18h → quiet banner.
- All writes validated (Fastify JSON schema / zod); bad `personId`/`teamCode` rejected.
- Pending photos never web-served; admin cookie httpOnly + signed; login + upload rate-limited.
- SSE auto-reconnect with catch-up refetch.

---

## 8. Suggested build order (for the implementation plan)

1. **Monorepo + DB foundation** — workspaces, Drizzle schema + migrations, seed from
   `data.js`, `bootstrap`/read endpoints, Compose dev. (Frontend can point at real read APIs.)
2. **Football adapter + worker** — `ApiFootballProvider`, crosswalk, baseline sync,
   `sync_log`, stale flag. (Tested against recorded JSON; live data optional at this stage.)
3. **Frontend data layer** — TanStack Query client returning the `SWEEP` shape; remove
   static `data.js`; loading/error states.
4. **Social layer + SSE** — watch/support endpoints, `/api/stream`, `useEventStream`,
   optimistic updates; live poller in the worker.
5. **Photos + admin** — upload + validation + moderation queue (fan **and** profile photos),
   admin auth/cookie, approve→live; `Av` renders approved `avatar_path` with initials fallback.
6. **Prod deploy** — Caddy container, prod Compose, TLS, env, smoke test on a real domain.

Each step is independently testable and leaves the app working.

---

## 9. Open items / to verify

- **API-Football at signup:** confirm WC 2026 (`league=1, season=2026`) is covered on Pro and
  the exact per-minute rate limit; confirm fixture/team ids for the crosswalk seed.
- **Domain & TLS:** which domain Caddy will serve (needed for auto-TLS in prod).
- **Backups:** Postgres dump cadence + photos volume backup (low-touch, but real pot → worth a
  nightly dump).
- **Scoring at tournament end:** the "in the money" tracker is informational during the group
  stage; the actual payout determination (top-3 finishers, all co-owners win) is confirmed but
  the knockout bracket data model is a v2 extension (`stage` already supports it).
