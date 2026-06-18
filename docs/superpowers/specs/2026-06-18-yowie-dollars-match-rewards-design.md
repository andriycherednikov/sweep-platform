# Yowie Dollars match rewards — design

**Date:** 2026-06-18
**Status:** Approved, ready for planning
**Branch:** `feat/yowie-dollars-statement` (builds on the just-added statement screen)

## Problem

Today the only ways to gain Yowie Dollars are the weekly/starting grants and winning a
wager. We want to reward engagement with the sweep itself:

- **+100** every time a participant makes a **correct match prediction**.
- **+300** every time a **team a participant owns wins** a match.

Both are granted automatically the moment a match goes final, and both appear in the new
Yowie Dollars statement with their own row type.

## Decisions (from brainstorming)

- **Correct prediction = the saved support pick matches the result.** A "prediction" is the
  existing per-person `support` pick (HOME / AWAY / DRAW) for a fixture. "Correct" means the
  pick equals the fixture result. Rewarded for **all** matches (group + knockout).
- **Owned-team win = +300 per match the owned team wins**, group + knockout. A draw never
  pays. Every co-owner of the winning team receives the **full** +300 (matches the existing
  `all_win` co-ownership rule).
- **Forward-only.** Rewards apply only to matches that go final after this ships. No
  backfill of already-finished matches.
- **Result source = `fixtureResult(f)`** (authoritative; honours `winnerCode`, i.e. ET /
  penalties), not the 90-minute score.
- **Minors are excluded.** Coins/Wagers is 18+ (minors can't see/use it; balance shows 0),
  so reward rows are granted only to adult accounts (`person.adult !== false`). Both reward
  paths join `person` (on the composite `(id, sweepId)`) and skip `adult === false`.

## Background (existing code)

- **`support` table** (`api/src/db/schema.js`): `{ sweepId, fixtureId, personId, teamCode }`,
  PK `(fixtureId, personId)`. `teamCode` is `f.t1Code` | `f.t2Code` | the literal `'DRAW'`
  (DRAW only valid in group stage). Written by `POST /api/support`
  (`api/src/routes/social.js`). **No server-side correctness logic exists today** — the
  verdict pills are computed client-side in `web/src/social.js`.
- **`ownership` table**: `{ sweepId, personId, teamCode }`, PK `(personId, teamCode)`,
  `teamCode` → `team.code`. A team may be owned by several people.
- **`fixtureResult(f)`** (`api/src/coins/settle.js`): returns `'HOME' | 'AWAY' | 'DRAW' |
  null`. Prefers `winnerCode` (ET/penalty-aware), falls back to score.
- **`coin_ledger`**: append-only signed rows `{ sweepId, personId, type, amount, refId,
  createdAt }`; unique `(sweepId, personId, type, refId)` → idempotent inserts via
  `.onConflictDoNothing()`. Current types: `grant | stake | payout | refund`.
- **Worker final detection** (`api/src/worker.js`): each 60s live tick computes
  `prevFinal` from current DB state, polls, then `newlyFinal = final && !prevFinal.has(id)`
  and runs `settleBets` per newly-final fixture (lines ~61-74). Because `prevFinal` is
  rebuilt from the DB every tick, already-final fixtures are never reprocessed — even after
  a worker restart. This is what makes "forward-only" automatic.
- **Statement** (`api/src/coins/ledger.js` `statementFor`, `web/src/screens-statement.jsx`):
  `statementFor` returns entries `{ id, type, amount, createdAt, balanceAfter, weekIndex,
  bet }`; `weekIndex`/`bet` are derived from `type`. `entryView(e)` maps type → `{ kind,
  title, sub }` and `KIND_ICON` maps kind → a Font Awesome icon.

## Design

### Constants — `api/src/coins/constants.js`

```js
export const PREDICT_REWARD = 100   // correct match prediction
export const TEAM_WIN_REWARD = 300  // a team you own wins a match
```

### New ledger types

`'predict'` and `'teamwin'`. The `type` column is free text — extend the comment in
`schema.js`; no migration needed (no enum/constraint). Both rows are keyed by
`refId = fixtureId`, so the unique `(sweepId, personId, type, refId)` constraint allows at
most one of each per person per fixture; re-runs are no-ops via `.onConflictDoNothing()`.

### New module — `api/src/coins/rewards.js`

```
grantMatchRewards(db, fixtureId, publish = () => {}) -> number (rows granted)
```

1. Load the fixture; return `0` unless `status === 'final'`.
2. `result = fixtureResult(f)`; if `null`, return `0` (result not determinable).
3. **Predictions (+100):** select `support` rows for `fixtureId`. For each, map
   `teamCode → pick`: `'DRAW'` stays `'DRAW'`; `f.t1Code → 'HOME'`; `f.t2Code → 'AWAY'`
   (anything else → skip). If `pick === result`, insert
   `{ sweepId, personId, type:'predict', amount: PREDICT_REWARD, refId: fixtureId }`
   with `.onConflictDoNothing()`.
4. **Owned-team wins (+300):** if `result !== 'DRAW'`, the winning team code is
   `result === 'HOME' ? f.t1Code : f.t2Code`. Select `ownership` rows where
   `teamCode === winningTeamCode`. For each, insert
   `{ sweepId, personId, type:'teamwin', amount: TEAM_WIN_REWARD, refId: fixtureId }`
   with `.onConflictDoNothing()`. (Per-owner; every co-owner gets the full amount.)
5. Collect the distinct `sweepId`s touched and `await publish({ type:'bet-settled',
   sweepId })` for each — the web client already invalidates the `['coins']` query cache on
   `bet-settled`, so balances + the open statement refresh with no new client event.
6. Return the count of granted rows (for logging/tests).

Notes:
- `support`/`ownership` rows carry their own `sweepId`, so this is inherently multi-sweep —
  grant per the row's `sweepId`, exactly like `settleBets`.
- Predictions and ownership are independent: a person can earn +100 (their pick) and +300
  (they own the winner) on the same match.

### Wire-in — `api/src/worker.js`

In the existing `newlyFinal` loop, after `settleBets`, add:

```js
try { await grantMatchRewards(db, r.id, (e) => publish(db, e)) }
catch (e) { console.error(`[grantMatchRewards] fixture ${r.id} failed:`, e.message) }
```

Independent try/catch so one fixture's failure can't block others. Forward-only is
inherited from `newlyFinal`.

### Statement surfacing

- **`statementFor`** (`ledger.js`): add `fixtureId` to each entry —
  `fixtureId: (r.type === 'predict' || r.type === 'teamwin') ? r.refId : null`.
  `bet` stays `null` and `weekIndex` stays `null` for these types.
- **`entryView` + `KIND_ICON`** (`screens-statement.jsx`):
  - `predict` → `{ kind:'predict', title: <match via S.fixture(e.fixtureId)>, sub:'Correct
    prediction' }`.
  - `teamwin` → `{ kind:'teamwin', title: <match>, sub:'Your team won' }`.
  - **Icons:** `predict` → the **stylish custom tick** (the shared `Tick` inline-SVG
    component already used by the won-bet `win` row — `web/src/screens-statement.jsx`), in
    **gold** (`.stmt-ic.predict { color: var(--gold) }`). `teamwin` → a golden **team** icon
    (Font Awesome `faUsers`, `.stmt-ic.teamwin { color: var(--gold) }`). The won-bet `win`
    row uses the same `Tick` in green — predict is the gold variant. `KindGlyph` already
    renders `Tick` for `win`; extend it to also render `Tick` for `predict`, and add
    `teamwin → faUsers` to `KIND_ICON`. (`.stmt-ic.predict`/`.stmt-ic.teamwin` colour rules
    are already in `styles.css`.)
  - Both amounts are positive → render green like other credits. Match title resolved the
    same way `bet` rows do (`S.fixture(id)` → `S.team(...).name v ...`); if the fixture
    isn't in the client cache, fall back to a generic title ("Correct prediction" /
    "Team won").
  - Icon colour assigned via `.stmt-ic.predict` / `.stmt-ic.teamwin` → both `var(--gold)`.

## Data flow

1. A match goes final during a live poll → worker `newlyFinal` includes it.
2. `settleBets` pays wagers; then `grantMatchRewards` inserts `predict` (+100) and `teamwin`
   (+300) ledger rows for the right people, idempotently.
3. `publish({type:'bet-settled', sweepId})` → SSE → client invalidates `['coins']`.
4. Balances update everywhere; the statement shows new "Correct prediction" / "Your team
   won" rows with running balance.

## Error handling / edge cases

- Result not determinable (`fixtureResult` null) → grant nothing.
- Drawn match → no `teamwin` (correct DRAW predictions still pay +100).
- Re-processing the same fixture → `.onConflictDoNothing()` makes it a no-op (no double pay).
- A pruned fixture client-side → statement falls back to a generic title (no crash).
- **Known cosmetic mismatch:** the client verdict pill uses the 90-minute score while the
  reward uses `winnerCode` (ET/penalties). For a knockout decided after 90 minutes these can
  disagree; the money follows `winnerCode` (authoritative) and the pill is left unchanged.
  Out of scope to reconcile here.

## Testing (TDD)

- **api `coins-rewards.test.js`** (Vitest + Testcontainers; seed a fixture, set `status:'final'`
  + `winnerCode`, insert `support`/`ownership` rows):
  - correct HOME pick → one `predict` +100; wrong pick → none.
  - correct DRAW pick on a drawn group game → +100; on that drawn game, no `teamwin`.
  - owner of the winning team → `teamwin` +300; two co-owners → +300 each; owner of the
    losing team → none.
  - a person who both picked correctly and owns the winner → both rows (+400 total).
  - idempotent: running twice grants the same totals (no duplicates).
  - per-sweep isolation: a support/ownership row in another sweep is granted under that
    sweep only.
- **api `coins-ledger.test.js`**: `statementFor` returns `fixtureId` (and `bet:null`,
  `weekIndex:null`) for a `predict` and a `teamwin` row; running balance still correct.
- **web `screens-statement.test.jsx`**: renders a `predict` row ("Correct prediction",
  +100, predict icon) and a `teamwin` row ("Your team won", +300, teamwin icon), resolving
  the match title from `S.fixture`.

## YAGNI / non-goals

- No backfill of past finals; no admin override; no per-stage reward tiers (flat 100/300);
  no splitting +300 across co-owners; no reconciling the client verdict pill with
  `winnerCode`; no new SSE event type (reuse `bet-settled` for cache invalidation).
