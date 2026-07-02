# Phase 1 — Generic Core Schema: Design

**Status:** Approved 2026-07-03. Implements phase 1 of the feasibility read
(`2026-07-01-multi-sport-sweep-platform-feasibility.md` §3, §8).

**Scope decision (owner-approved):** Phase 1 = new schema + fresh migrations +
seed **and the api layer ported onto it** (routes, worker writes, serializers,
settlement reads), keeping the wire contract stable so the web app runs
untouched. Provider-registry extraction is Phase 2 — not built here, not
blocked here.

**Sports in scope for config:** football (reference), basketball/NBA (phase-2
proof). Both head-to-head. (NRL was considered 2026-07-03 and dropped —
API-Sports' Rugby API doesn't carry it.)

---

## 1. Approach

Competition-scoped rows with surrogate text ids. Every feed table carries a
`competitionId`; natural codes (`FRA`, `LAL`) are unique **per competition**,
never global — two competitions in one DB is the product. Provider identity is
a column, not a crosswalk table (we committed to API-Sports; `provider` on
`competition` keeps the door open).

Rejected: mechanical rename keeping `code` PKs (collides the moment a second
competition exists); provider-native numeric PKs (vendor-couples row identity,
awkward seeds/tests).

## 2. Tables

New feed core (replaces `team`/`fixture`/`standing`/`team_crosswalk`):

- **`competition`** — `id` text PK (`<provider>:<leagueId>:<season>`, e.g.
  `apifootball:1:2026`), `provider`, `sport`, `leagueId`, `season`, `format`
  (`league | groups_then_ko | knockout`), `name`, `logo`, `createdAt`.
  `unique(provider, sport, leagueId, season)`.
- **`competitor`** — `id` text PK, `competitionId` FK → competition, `code`,
  `name`, `color`, `logo`, `providerId` integer nullable (replaces
  `team_crosswalk`), `meta` jsonb (soccer group/pool/strength/squad, NBA
  conference…). `unique(competitionId, code)`, plus
  `unique(id, competitionId)` — the target for composite FKs that pin child
  rows to the competitor's competition (same pattern as
  `person_id_sweep_id_uq`).
- **`event`** — `id` text PK, `competitionId` FK, `c1Code`/`c2Code` → competitor
  via composite FKs `(cNCode, competitionId) → competitor(code, competitionId)`
  (an event can never mix competitors across competitions; referencing by **code**
  rather than surrogate id keeps the winnerCode/code contract identical end to end
  — plan-time refinement, 2026-07-03), `startUtc`, `status`, `score1`, `score2`, `winnerCode` (winning
  competitor **code** or `'DRAW'` sentinel, set when final — authoritative
  over raw score, same contract as today), `round`, `stage`, `detail` jsonb
  (matchday, venue/city, HT/reg/pen scores, lineups, match events, statistics,
  derby, live phase, win probabilities), `updatedAt`.
  Index on `(competitionId, startUtc)`.
- **`ranking`** — PK `(competitionId, competitorCode)`, `rank` integer,
  `points` integer, `stats` jsonb (soccer: played/W/D/L/GF/GA; NBA: its
  own shape), `updatedAt`. Composite FK `(competitorCode, competitionId)` →
  `competitor(code, competitionId)` so a ranking row can't cross competitions
  (same plan-time code-reference refinement as `event`).

Account layer (stub — the seam for phases 3–4, no auth/routes yet):

- **`account`** — `id` text PK, `email` unique not null, `name`, `createdAt`.

Ported tenancy tables (same composite-tenant-FK design, re-keyed):

- **`sweep`** — inherited columns + `competitionId` FK not null +
  `accountId` FK nullable.
- **`person`** — unchanged (incl. `unique(id, sweepId)` target and
  `excludedUntil` self-exclusion contract).
- **`ownership`** — `teamCode` → `competitorId` FK → competitor.
- **`support`** — `fixtureId` → `eventId` FK → event; pick column stays text
  (competitor code or `'DRAW'`).
- **`bet`** — `fixtureId` → `eventId` FK → event; otherwise unchanged.
- **`coinLedger`**, **`parlay`**, **`photo`** (photo's `fixtureId` →
  `eventId`, still `onDelete: set null`), **`syncLog`** — unchanged.

Sport config is a **code constant**, not a table:

```js
// api/src/sports.js
export const SPORTS = {
  football:   { hasDraws: true },
  basketball: { hasDraws: false },
}
```

`scoring_rule` stays text on `sweep`; the registry of rules
(`league_topN`, `group_placement`, `knockout_survival`) keys off
`competition.format` and lands with real scoring work, not Phase 1 (the
inherited `top3` default is currently inert server-side).

## 3. Migrations

Greenfield: delete `api/migrations/` (23 inherited WC migrations), regenerate
from the new `schema.js` via `drizzle-kit generate` as migration **0001**.
`migrate.js`, `drizzle.config.js`, npm scripts unchanged. Runs only against
the new local `sweep_platform` database — never `sweep` (live WC dev data).

## 4. Data flow (the port)

- **Worker** — `baseline-sync`/`live-poller` keep their shape (upsert + delta
  writes + `syncLog` + on-final chain `recomputeStandings → settleBets →
  grantMatchRewards`) but write `event`/`ranking` scoped by `competitionId`.
  The worker iterates **competitions having ≥1 active sweep** — the §7
  dedupe-by-competition; with one seeded competition it degenerates to
  today's behavior. The existing api-football adapter keeps its call sites
  (registry is Phase 2); only its DB-write layer re-points. Crosswalk-sync
  becomes `providerId` resolution on `competitor` (same loud asserts).
- **Routes/serializers** — `serialize.js` keeps emitting today's wire shape
  (`teams`, `fixtures`, `standings`, `t1`/`t2`, `winnerCode`…) while reading
  competitor/event/ranking filtered by the sweep's `competitionId`. Web app
  and its 436 tests stay untouched.
- **Settlement** — `fixtureResult()` (winnerCode-first, score fallback)
  contract preserved on `event`; `coins/settle.js`/`rewards.js` re-point
  mechanically.
- **Seed** — inherited WC generator adapts: one `competition` row (WC 2026,
  `format: groups_then_ko`), competitors/events/rankings under it, the
  `'default'` sweep bound to it, personas/ownership as today.
- **Dead code dies in the port** — e.g. `sync-teams.js` writing
  `photo.team_code` (column dropped in inherited migration 0002).

## 5. Error handling

No new surface. Inherited patterns carry over: loud asserts on provider-id
resolution, `syncLog` row per sync outcome, tenancy enforced by composite FKs
at the DB, `'DRAW'`/winnerCode contract unchanged end to end.

## 6. Testing

- Strict TDD; api suite runs on testcontainers (own throwaway PG — no risk to
  local databases). The 293 inherited api tests port by re-keying test
  fixtures to competition-scoped rows; assertions on wire shapes stay.
- Web suite (436) must pass unmodified — that is the proof the wire contract
  held.
- Local dev DB: create `sweep_platform`, point `DATABASE_URL` at it, verify
  the connection target before any migration/seed.

## 7. Out of scope (Phase 1)

Provider registry interface (P2), NBA adapter (P2), catalog +
self-serve + auth (P3), Stripe/billing (P4), wagering generalization/market
spine (P5), web reskin/vocabulary (P6).
