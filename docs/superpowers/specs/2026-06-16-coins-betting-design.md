# Coins — a friendly betting ring inside The Sweep (design spec)

Date: 2026-06-16 · Status: approved, ready to plan

## Context

The Sweep is a community FIFA World Cup 2026 app (~45 participants). Today people *predict*
match winners (the `support` feature) and a leaderboard ranks correct guesses. We want a
more engaged, season-long way to play: give everyone **play-money coins**, let them **bet
on real bookmaker odds** we already pull from API-Football, **settle** bets automatically
when matches finish, and let people watch how high they can grow their stack across the
tournament. Pure fun, no real money — but it should feel like a real book.

## Decisions

- **Economy:** one **persistent balance** per person. **1000 starting coins + 1000/week**
  top-up. Winnings accumulate. A season-long climb.
- **Odds:** **real bookmaker decimal odds**, **Pinnacle-first** with a fallback chain
  (Bet365 → first book with a complete Match Winner market). Odds **lock at bet time**.
- **Market & scope:** Match Winner **1X2** (Home / Draw / Away). **Group stage first**;
  schema and UI are built so knockouts ("to qualify") slot in later with no rework.
- **Bet rules:** **multiple independent bets per match** (even on different outcomes), each
  locking its own price. Whole-coin stakes from **1** up to the current balance. Bets
  **lock at kickoff**.
- **Surfaces:** a **dedicated Coins tab** (wallet + bettable matches + open/settled bets).
  The **ranking** rides alongside the existing predictions leaderboard on the **People
  screen** as a third stat toggle (Wins / Predictions / **Coins**).
- **Trust:** identity is unauthenticated (a localStorage `personId`), so **balance and
  settlement are enforced server-side** from an append-only ledger — a client can never bet
  more than it holds, settle its own bets, or self-credit.

## Provider capability (researched)

API-Football does **not** settle or grade bets — `/odds` and `/odds/live` return prices
only (`bookmaker → bets → values`: a selection label + decimal odd); there is no
won/lost/winning-value field and no settlement endpoint. (`/odds/bets` is just the catalog
of market *types*.) **We own settlement.**

However, the `/fixtures` payload we already consume carries authoritative results we don't
yet map: **`teams.home.winner` / `teams.away.winner`** booleans (which already account for
extra time and penalties) and a **`score.halftime/fulltime/extratime/penalty`** breakdown,
with `fixture.status.short` ∈ {`FT`,`AET`,`PEN`}. Mapping the `winner` booleans makes
settlement an authoritative lookup rather than our arithmetic, and removes the knockout
edge case entirely — so "group first" is purely a market/UI scope decision, not a technical
limit.

## Architecture

The backend mirrors the proven `support` vertical slice — table → route → `app.publish`
SSE → optimistic web store → SSE reconcile via TanStack Query invalidation. Everything new
is **tenant-scoped** with the existing `(personId, sweepId) → person(id, sweepId)`
composite-FK pattern (see `ownership`/`watch`/`support`).

### Data model (`api/src/db/schema.js` + a Drizzle migration)

- **Decimal odds on `fixture`** (Match Winner market): `oddsHome`, `oddsDraw`, `oddsAway`
  (numeric, nullable), `oddsBook` (text — the chosen bookmaker's name). The existing
  `probA/probD/probB` percents remain for the current `ProbBar` display.
- **Authoritative result on `fixture`**: `winnerCode` (text, nullable — the winning team
  code, or `'DRAW'`, set when final), resolved from `teams.*.winner` via the crosswalk.
- **`coin_ledger`** — append-only, the single source of truth for balances.
  `id`, `sweepId`, `personId`, `type` (`grant`|`stake`|`payout`|`refund`), `amount`
  (signed int), `refId` (week index for grants, bet id otherwise), `createdAt`. Composite
  FK `(personId, sweepId)`. **Unique `(sweepId, personId, type, refId)`** → grants and
  payouts are idempotent. **Balance = SUM(amount)**.
- **`bet`** — `id`, `sweepId`, `personId`, `fixtureId` (FK), `selection`
  (`HOME`|`DRAW`|`AWAY`; room for `ADVANCE`/team-code later), `stake` (int), `oddsDecimal`
  (locked price), `book`, `potentialPayout` (= round(stake × odds)), `status`
  (`open`|`won`|`lost`|`refunded`), `placedAt`, `settledAt`. Composite FK
  `(personId, sweepId)`; index on `fixtureId`.

### Weekly grants — lazy & idempotent (no cron)

Anchor to the **earliest fixture kickoff** (tournament start). Week index =
`floor((now − anchor) / 7d)`, clamped ≥ 0. On every wallet read / bet, backfill any missing
`grant` rows for weeks `0..currentWeek` (week 0 = the 1000 starting bankroll; each later
week = +1000). The unique constraint makes re-runs no-ops, so no scheduler is needed and
everyone ends up with equal grants regardless of when their wallet was first touched.

### Odds & result capture (worker)

Enhance `mapOdds` (`api/src/providers/mapping.js`) to choose the bookmaker by a **ranked
name list** (`['Pinnacle','Bet365', …]`, else the first book with a complete 1X2 market)
and return both the existing `{a,d,b}` percents **and** the raw `{home,draw,away}` decimals
+ book name. Enhance `mapFixture` to read `teams.*.winner` and, when final, resolve a
`winnerCode`. `baseline-sync.js` / `live-poller.js` persist the new odds + `winnerCode`.
Odds cadence is unchanged (~4×/day, pre-match) — fine because bets lock the price at
placement. Serialize as `odds: { home, draw, away, book }` in `api/src/serialize.js`.

### Settlement (worker)

`fixtureResult(fixture)` returns the winning selection — preferring the authoritative
`winnerCode` (handles ET/penalties), falling back to `score1`/`score2` for group games;
shared with `recompute-standings.js`. `settleBets(db, fixtureId, publish)` settles every
`open` bet across **all sweeps** for a newly-final fixture: `won` → a `payout` ledger row
(= stake × locked odds, which returns the stake too); `lost` → no ledger row (stake was
already deducted at placement); mark `status`/`settledAt`. Idempotent — only `open` bets are
touched and the unique ledger refId guards against double-pay. Hooked into the existing
newly-final detection in `api/src/worker/worker.js` (beside `recomputeStandings`) and the
baseline reconcile; publishes `{type:'bet-settled', sweepId}` per affected sweep.

### API routes (`api/src/routes/coins.js`, mirroring `routes/social.js`)

- `GET /api/coins` → `{ balance, weeklyGrant, bets: { open, settled },
  leaderboard: [{ personId, balance }] }` for the current sweep (drives the Coins tab and
  the People stat). `requireSweep(['member','admin'])`.
- `POST /api/bet` `{ fixtureId, personId, selection, stake }` → validates the fixture is
  `upcoming` and has odds, the selection is valid for the stage, and `stake` is an int ≥ 1;
  then **atomically** (single tx) re-checks `balance ≥ stake`, writes the `stake` ledger
  row (−stake) and the `open` bet with the locked odds/book/payout. Publishes
  `{type:'bet'}`.

### Web layer

- **`web/src/api/client.js`:** `fetchWallet()`, `postBet({fixtureId, personId, selection, stake})`.
- **`web/src/coins.js`** (new store, modeled on `social.js`): optimistic balance/bet writes
  with rollback-on-failure + `toast`; hydrated by a `['coins']` query; reconciled via SSE.
- **`web/src/hooks/useEventStream.js`:** add `bet` / `bet-settled` branches → invalidate
  `['coins']`. `Gate` (`SweepProvider.jsx`) adds the `['coins']` query.
- **Coins tab:** add `"coins"` to `TABS`/`urlFor`/`readView` (`App.jsx`), a `CoinsScreen`
  branch, an `Icon.coin` SVG, and entries in `BottomNav`/`Sidebar` (`components.jsx`); the
  bottom-nav grid goes `repeat(5,1fr)` → `repeat(6,1fr)` (`styles.css`).
- **`CoinsScreen`:** wallet header (balance + next weekly top-up note), a list of upcoming
  bettable matches with live odds + a place-bet sheet (stake input, locked-price preview,
  potential payout), open bets, and settled history. Reuses `--gold` tokens,
  `.block`/`.cta`/`.sheet`, and the kickoff-lock gating from `CrowdPick`.
- **People screen:** extend the existing Wins/Predictions stat toggle with **Coins** (ranks
  by the server balance from the `/api/coins` leaderboard).

## Testing

TDD per task (Vitest + `@testcontainers/postgresql`, Docker required):

- Odds: bookmaker selection + fallback chain; decimals captured; `winnerCode` mapped
  (including a penalty-decided fixture).
- Ledger: weekly-grant backfill is idempotent; balance = SUM(ledger).
- Bet: insufficient funds rejected; price locked at placement; post-kickoff rejected;
  multiple independent bets allowed.
- Settlement: win pays out (stake × odds), loss keeps stake deducted, draw, idempotent
  re-run; SSE published per sweep.
- Web build clean.

## Concurrency

`POST /api/bet` does the balance check **and** the stake deduction inside one transaction,
guarded by a transaction-scoped Postgres advisory lock keyed on `(sweepId, personId)`
(`pg_advisory_xact_lock(hashtext(sweepId), hashtext(personId))`). This serializes a single
person's concurrent bets so two simultaneous requests can never both pass the check and
overdraw — the second recomputes `SUM(ledger.amount)` after the first commits and is
rejected with `insufficient_funds`. Different people never contend (distinct lock keys).

## Out of scope (now)

Knockout "to qualify" betting (schema/UI leave room), in-play/live odds refresh, cash-out,
parlays/accumulators, and an admin manual-void UI (the `refund` ledger type exists for
later).
