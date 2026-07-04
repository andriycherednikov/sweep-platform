# Phase 3 — Catalog + Self-Serve Creation + Account Layer: Design

**Status:** Approved 2026-07-04 (owner decisions: auth = magic-link email;
surface = **API-only** this phase — the web suite stays frozen at 436
unmodified; catalog exposure = **curated flag over a full sync**). Implements
phase 3 of the feasibility read
(`2026-07-01-multi-sport-sweep-platform-feasibility.md` §5, §8).

**Inputs:** Phase 2 merged (provider registry, NBA proven end to end).
Phase-3 prereqs landed (`933af17`..`231eee1`): football `fetchCompetitions`
returns the full catalog, cutover selects football-only, explicit `live` flag
on adapters, competitor-delete FK guard, registry cache keyed by apiKey,
`winnerSideToResult` garbage guard. Catalog shape verified live —
`2026-07-04-p3-catalog-shape.md` (football Pro key shared with the live WC
app; basketball free tier 100/day is the binding budget; coverage flags are
pessimistic for unstarted seasons; basketball has no `current` flag and mixed
season types; ~956 league-seasons pass the coverage filter).

**Hard rule this phase:** the catalog is persisted; nothing fetches provider
catalogs per user request. Budget every live call.

## 1. Approach

The account layer is a thin ownership + auth shim over the existing sweep
machinery: opaque tokens (house culture), Fastify preHandlers, three new
tables. The catalog is a small Postgres table refreshed by a daily job
(2 requests/day total), exposing only curated rows. Provisioning reuses
`addCompetition` + the existing sweep-create path, re-keyed from super-token
to account ownership; competitions are deduped across sweeps (§7 of the
feasibility read: N sweeps on one competition = one poll).

Rejected: JWT/cookie sessions for the API-only phase (header token is
curl-friendly; a cookie wrapper can sit on the same session table when UI
lands); async provisioning jobs (synchronous is seconds for NBA-sized
competitions; revisit with UI); exposing all ~956 coverage-filtered leagues
(unverified formats = broken sweeps; curation is a data flip, not code).

## 2. Schema (3 new tables)

`account` (id, email unique, name, createdAt) and `sweep.accountId` exist
from P1.

- **`login_token`** — `token` pk, `email`, `createdAt`, `expiresAt` (15 min),
  `usedAt`. Keyed by **email, not account**: the account row is created only
  when a link is USED (verified email) — typos/spam never create accounts.
- **`account_session`** — `token` pk, `accountId` FK, `createdAt`,
  `expiresAt` (90 days). Opaque token, sent as `x-account-token`.
- **`catalog_league`** — `id` pk (`<provider>:<leagueId>`), `provider`,
  `providerLeagueId`, `name`, `type`, `logo`, `country` jsonb
  `{name, code, flag}`, `seasons` jsonb
  `[{season, start, end, current, standings, odds}]`, `curated` bool default
  false, `updatedAt`. ~1.7k rows. **Upsert never touches `curated`** — the
  flag survives every re-sync.

## 3. Auth (magic link)

- `POST /api/account/login {email}` — rate-limited (5/15min/IP), email
  normalized lowercase, always returns `{ok:true}` (no account-existence
  leak). Writes a `login_token`, sends the link via `app.sendMail`.
- **`app.sendMail(to, subject, body)`** — decorated seam; the only
  implementation this phase is a console logger (dev reads the link from API
  logs). Real provider is an ops decision later; the seam is the design.
- `POST /api/account/session {token}` — token must be unexpired and unused;
  marks `usedAt`, **upserts account by email** (`onConflictDoNothing` +
  re-select to survive the race), inserts an `account_session`, returns
  `{accountToken, account: {id, email, name}}`.
- `requireAccount` preHandler (mirrors `requireSuper`): resolves
  `x-account-token` against unexpired sessions → `req.account`, else 401.
- `GET /api/account` — whoami.
- **P4 slot-in:** subscription gating is one added check in
  `requireAccount`/the provision path; nothing here blocks it.
- Account routes are host-independent (no `platformHost` coupling).

## 4. Catalog

- `mapLeague` (both sports) gains `country {name, code, flag}` and per-season
  coverage booleans `standings`/`odds`; basketball's mixed int/string seasons
  normalized by the existing `String(season)`.
- `syncCatalog(db, provider)` — `fetchCompetitions()` → upsert
  `catalog_league` (name/type/logo/country/seasons; never `curated`). Rows
  whose league left the feed: kept (harmless, curated ones must not vanish).
- Refresh: worker cron **daily** + `catalog:sync` CLI. Cost: **2 requests/day
  total** (one `/leagues` per API).
- **Provisionable season** = in the provider's season window ∧
  `standings: true` for that season. The window comes from per-provider
  config (football: open — Pro key; basketball: `2022–2024` — free tier),
  NOT from coverage flags: plan gating is invisible in the feed (verified).
- `GET /api/catalog?sport=&q=` (account-authed) — **curated rows only**,
  case-insensitive name/country match, each row carrying its provisionable
  seasons. Limit 50.
- `catalog:curate <provider> <leagueId> [--off]` CLI — curation without
  psql. Initial curated set: World Cup (1), Premier League (39), La Liga
  (140), Serie A (135), Bundesliga (78), Ligue 1 (61), NBA (12).

## 5. Provisioning + ownership

`POST /api/account/sweeps {name, provider, leagueId, season}` (account-authed):

1. **Cap:** count my unarchived sweeps; ≥ `ACCOUNT_SWEEP_CAP` (env, default
   **3**) → 403 `{error: 'sweep_cap'}`. Protects the feed budget until
   billing lands; P4 replaces the constant with subscription quantity.
2. **Catalog validation:** league must be curated and the season
   provisionable → else 400 `{error: 'unknown_competition'}`.
3. **Competition:** exists **with events** → reuse as-is. Exists but
   eventless (an earlier provision died mid-baseline) → re-run
   `syncCompetitors` + `syncBaseline` before binding. Else `addCompetition`
   — **re-pointed to read league meta (name/logo/type) from
   `catalog_league` instead of calling `fetchCompetitions()` live** (the
   budget rule made code). `syncCompetitors` + `syncBaseline` still hit the
   live feed (competition data, not catalog; ~4 requests for NBA-sized).
   Synchronous in-request.
4. Insert the sweep with `accountId`; respond 201 with member/admin links
   (existing `links()` helper).

- `GET /api/account/sweeps` — my sweeps with links.
- `POST /api/account/sweeps/:id/archive` — owner-scoped (404 on others'),
  frees a cap slot. Super routes stay untouched for ops.

## 6. Feed-budget fixes riding along

- **Odds-loop windowing:** `syncBaseline`'s football odds/predictions loop
  currently hits EVERY fixture (~100–200 requests per WC baseline; a
  provisioned EPL would be ~1,500–3,000/day). It will skip fixtures that are
  `final` or kick off more than 7 days out — `detailMerge` already preserves
  previously stored odds, and odds are only actionable pre-kickoff.
  Deliberate behavior change to the existing WC baseline; approved.
- **`syncCompetitors` cadence** (closes the carried-over item): the worker's
  00:10 UTC baseline run re-runs `syncCompetitors` for feed-born
  (`dropUnknownTeams`) competitions — +2 basketball requests/day, bounded by
  active competitions.
- **Feed cost per catalog refresh: 2 requests.** Documented here per the
  phase success criteria.
- Local `.env`: drop the `PLATFORM_HOST=localhost:3000` leftover (restores
  the documented dev behavior — plain localhost = default sweep).

## 7. Error handling

House style: loud 4xx JSON errors (`unknown_competition`, `sweep_cap`,
`unauthorized`), always-200 on `/login` (privacy), syncLog rows for catalog
sync outcomes, CLI guards print-and-exit non-zero, provision failures roll
back nothing silently — a failed `syncBaseline` leaves the competition row +
competitors for a retry to reuse (idempotent), and the sweep is only created
after a successful baseline.

## 8. Testing

- Strict TDD; testcontainers as today. Web suite passes **unmodified (436)**.
- Recorded providers extend naturally: football `leagues.json` is live-real
  (2 leagues incl. coverage); basketball fixtures already live-captured.
- Key tests: login-token TTL/single-use/reuse-refusal; always-200 login;
  account upsert race; session expiry; `requireAccount` 401s; catalog sync
  idempotence + curated-flag survival + gone-league retention; season-window
  vs coverage filter (incl. the "current season standings:false" trap);
  catalog search; provision happy path (competition created, baseline
  synced, sweep owned, links returned); provision reuse (second sweep, same
  competition — no re-provision); cap enforcement + archive frees a slot;
  non-curated/out-of-window 400s; odds windowing (final + far-future fixtures
  skipped, near upcoming fetched); daily syncCompetitors gate;
  **e2e proof:** login → session → browse → provision NBA and a football
  league from recorded feeds → member link serves fixtures → 4th sweep
  blocked → archive → 4th succeeds.
- Dev verification: `catalog:sync` live (2 requests), curate the initial
  set, provision one sweep via the API without psql/super-token.

## 9. Out of scope

Stripe + lifecycle gating (P4 — slots into `requireAccount`), wagering (P5),
any web UI (next phase), third provider + event-id keyspace fix (gates a
third provider, not this), real email provider (console mailer behind the
seam), account deletion/email change (YAGNI until billing).
