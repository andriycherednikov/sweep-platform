# Multi-bet (parlay / accumulator) — design

**Status:** approved design, ready to plan
**Date:** 2026-06-19
**Feature area:** Wagers / Yowie Dollars (`coins` namespace)

## 1. Summary

Add **parlay (accumulator) betting** to the existing single-bet Wagers feature. A parlay
combines **two or more** selections, each on a **different** fixture (**any stage — the full
tournament**, group and knockout), into one bet with a single stake. The combined odds are
the **product** of the leg odds. **All legs must win** for the parlay to win; **losing any
one leg loses the whole bet immediately**. There is no cash-out and no editing after
placement.

The UI moves to a **unified accumulating betslip**: tapping an odds button adds a selection
to a persistent slip; the user opens the slip, enters one stake, and places. **One leg = a
normal single bet** (existing path, unchanged); **two or more legs = a parlay** (new path).
Legs are individually **removable** from the slip.

This builds directly on the shipped single-bet system (`bet` table, `coin_ledger` wallet,
`resolveBet` grader, worker settlement, optimistic `coins.js` store). It also **lifts the
current group-stage-only restriction for the whole Wagers feature** (singles and parlays
alike) by adding correct **regulation-time (90-minute) settlement** for knockout fixtures —
see §6.5.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Core form | Parlay/accumulator across **different** fixtures; **1 leg per fixture** |
| 2 | Settlement | **Standard, no cash-out, no post-place edit.** Any leg lost → whole parlay lost immediately; all legs won → pays `stake × Π(odds)` when the last leg finishes |
| 3 | Leg count | **Min 2** (1 selection is just a normal single bet), **no maximum** |
| 4 | Betslip UX | **Unified accumulating betslip.** Tap odds → add to slip; 1 leg = single, 2+ = parlay. Legs **removable**. |
| 5 | Data model | **Approach C** — new `parlay` parent table + nullable `bet.parlayId`; legs are reused `bet` rows |
| 6 | Odds drift | **Place at current server odds**, show a subtle "odds updated" note + refreshed payout preview; the bet still places |
| 7 | Slip persistence | **In-memory for v1** (page reload clears the slip); localStorage persistence is a later enhancement |
| 8 | Void/prune | If a leg's fixture is pruned/voided, **refund the whole parlay** (no continue-on-remaining-legs) |
| 9 | Tournament scope | **Full tournament for the entire Wagers feature** — group **and** knockout, for **singles and parlays**. Lifts the current group-stage-only gate. |
| 10 | Knockout settlement | **Regulation-time (90-minute).** Settle `1x2`/`ou25`/`cs` on the 90' score; count `cards` events at `minute ≤ 90`. A KO match decided in ET/penalties still settles on its 90' result. |
| 11 | Closed-event notice | If any leg's fixture has closed (kicked off / final / pruned), **explicitly notify** the user both **when the slip is opened** and **on a submit attempt**, and block placement until the closed leg is removed. |

## 3. Data model (Approach C)

Schema lives in `api/src/db/schema.js`. Migration is **additive only**.

### New table `parlay`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | **Prefix `par_…`** so its `coin_ledger.refId` never collides with a `bet` id |
| `sweepId` | text | tenant |
| `personId` | text | composite FK `(personId, sweepId)` → `person`, same invariant as `bet` |
| `stake` | int | coins staked |
| `combinedOdds` | numeric | `Π(legOdds)`, computed server-side at placement |
| `potentialPayout` | int | `round(stake × combinedOdds)`, **includes stake** |
| `status` | text | `open` \| `won` \| `lost` \| `refunded`, default `open` |
| `placedAt` | timestamptz | |
| `settledAt` | timestamptz | nullable |

Indexes: `parlay_sweep_id_idx` on `sweepId`. Composite FK `parlay_person_sweep_fk` on
`(personId, sweepId)` (mirrors `bet_person_sweep_fk`).

### New column on `bet`

- `parlayId` text, **nullable**, FK → `parlay.id` **`ON DELETE CASCADE`**.
- Index `bet_parlay_id_idx`.

### Legs reuse `bet` rows

A leg is a normal `bet` row with:
- `parlayId` set to the parent,
- `stake = 0`, `potentialPayout = 0` (money lives only on the parent / in `coin_ledger`),
- `fixtureId`, `market`, `selection`, `line`, `oddsDecimal`, `book` as picked,
- `status` graded independently (`open` → `won`/`lost`).

**Existing singles are 100% untouched** — they have `parlayId = NULL`.

### New columns on `fixture` (regulation-time score — see §6.5)

- `regScore1` int, **nullable** — home goals at the **end of 90 minutes** (`raw.score.fulltime.home`).
- `regScore2` int, **nullable** — away goals at the end of 90 minutes.

For group-stage matches these always equal `score1`/`score2` (no extra time). They differ
only for knockout matches that go to extra time / penalties, where `score1`/`score2`
(`raw.goals`) include ET goals but `regScore*` hold the 90' result the odds are priced on.

### Migration

`api/migrations/0014_*.sql` (drizzle-kit generate): add the `parlay` table, `bet.parlayId`,
`fixture.regScore1`/`regScore2`, and the indexes. Non-destructive; existing bets get
`parlayId = NULL`. **Backfill** `regScore1 = score1, regScore2 = score2` for existing rows —
correct, since every already-final fixture to date is group-stage (no ET); the worker keeps
`regScore*` current from `raw.score.fulltime` going forward. After generate, run
`npm run db:migrate -w api` against the shared dev DB (per the standing note: green
Testcontainers tests do **not** migrate the shared dev DB).

## 4. Money / wallet

Balance is unchanged: `SUM(coin_ledger.amount)` for `(sweepId, personId)`.

- **Stake:** one `coin_ledger` row `type='stake'`, `amount = -stake`, `refId = parlayId`.
- **Payout:** on a win, `type='payout'`, `amount = +potentialPayout`, `refId = parlayId`.
- **Refund:** on void/prune, `type='refund'`, `amount = +stake`, `refId = parlayId`.
- **Legs never create ledger rows** → they never touch the balance or leaderboard.

The existing unique constraint `coin_ledger_entry_uq (sweepId, personId, type, refId)` keeps
stake/payout/refund **idempotent**. The `par_…` id prefix keeps the parlay `refId` namespace
visibly distinct from single-bet ids.

## 5. API

### `POST /api/parlay` (new) — `requireSweep(['member','admin'])`

**Body:**
```json
{
  "personId": "…",
  "stake": 100,
  "legs": [
    { "fixtureId": "…", "market": "1x2", "selection": "HOME" },
    { "fixtureId": "…", "market": "ou25", "selection": "OVER" }
  ]
}
```
`market` is enum-restricted to `MARKETS` (`['1x2','ou25','cards','fh1x2','cs']`, default
`'1x2'`); `stake >= 1`; `legs.length >= 2`.

**Validation order (whole parlay rejected on first failure — no partial placement):**
1. Person belongs to sweep.
2. `adult !== false` else `403 minor_not_allowed`.
3. `legs.length >= 2` else `400 too_few_legs`.
4. No duplicate `fixtureId` across legs else `400 duplicate_fixture`.
5. **Per leg**, reusing the single-bet "bettable" chain (**no stage check — full tournament**):
   - fixture exists else `fixture_not_found`
   - `status === 'upcoming'` else `leg_betting_closed`
   - market+selection exist with valid odds else `leg_no_odds`

   (A TBD knockout fixture, or any fixture the book hasn't priced, simply has no odds, so it
   fails `leg_no_odds` and can't be added — no separate stage gate needed.) Per-leg errors
   identify the offending leg (e.g. `{ error, fixtureId, market, selection }`) so the client
   can highlight it.
6. `ensureGrants`, compute `combinedOdds = Π(legOdds)`, `potentialPayout = round(stake × combinedOdds)`.
7. Inside a transaction holding `pg_advisory_xact_lock(sweepId, personId)` (same lock the
   single-bet route uses): re-read balance → `stake <= balance` else `insufficient_funds`
   → insert the `stake` ledger row, the `parlay` row, and the N leg `bet` rows atomically.

**Response:** `{ parlay: serializeParlay(row, legs), balance }`.
**Publishes:** `{ type:'bet', sweepId, personId, parlay:true, legCount }` — **never the stake.**

### `GET /api/coins` (modified)

Add `parlays: { open: [...], settled: [...] }` (newest-first), each via `serializeParlay`.
**Critically**, the existing `bets.open` / `bets.settled` queries must add `WHERE parlayId IS
NULL` so leg rows don't surface as phantom singles. The `bets` shape is otherwise unchanged
(back-compat).

### `serializeParlay` (new, in `api/src/coins/ledger.js`)

```
{ id, stake, combinedOdds, potentialPayout, status, placedAt, settledAt,
  legs: [ serializeBet(leg), … ] }
```

`serializeBet` is reused unchanged for each leg.

## 6. Settlement (`api/src/coins/settle.js`)

`resolveBet(market, selection, line, fixture)` stays the pure grader, but its internals
move to **regulation-time** grading (§6.5) so knockout fixtures settle correctly. Its
signature and return contract (`'won' | 'lost' | null`) are unchanged, so `settleBets` and
the per-row claim logic are untouched by that change.

### `settleBets(db, fixtureId, publish)` (modified)

For each **open** `bet` row on the now-final fixture:
- `parlayId IS NULL` (single) → grade via `resolveBet`; if `won`, claim
  (`UPDATE … WHERE status='open'`) + insert payout ledger — **exactly as today**.
- `parlayId` set (leg) → grade; claim + set leg `status` to `won`/`lost`; **do not pay**.
  Collect the distinct `parlayId`s touched.

Then call `settleParlay` for each affected parlay.

### `settleParlay(db, parlayId, publish)` (new)

Read the parlay's leg statuses, decide the transition, then apply it with a **guarded
`UPDATE parlay SET … WHERE id=? AND status='open'`** (so concurrent/retried settlement
transitions exactly once — no double-pay):
- **Any leg `lost`** → parlay `lost`, `settledAt = now`. (Stake already debited; no payout.)
- **All legs `won`** → parlay `won`, `settledAt = now`, insert `+potentialPayout` payout
  ledger (`refId = parlayId`).
- **Otherwise** (some legs still open) → leave `open`; no-op (a later fixture will retrigger).

Publishes one `bet-settled` per affected sweep on a real transition.

### `settleStaleBets(db, publish)` (modified — safety net)

In addition to the current single-bet sweep, find **open parlays** that should have settled
— any leg already `lost`, **or** every leg's fixture is `final` and graded — and run
`settleParlay`. Idempotent.

### Worker

`api/src/worker.js` live tick is **unchanged in signature**: on a fixture going final it
already calls `settleBets` (which now also grades legs + rolls up parlays) then
`grantMatchRewards`. The `*/10` stale cron picks up cross-fixture parlays whose last leg
finished between ticks.

### Void / prune edge

`api/src/worker/baseline-sync.js` prunes a removed fixture by deleting its `bet` + ledger
rows. New behaviour: if a pruned fixture has parlay-**leg** bets, **refund the whole
parlay(s)** first — for each touched parlay still `open`, insert a `+stake` `refund` ledger
row (`refId = parlayId`), set parlay `status='refunded'`, `settledAt=now`, then let the
`ON DELETE CASCADE` drop its legs. This matches the "simplest" decision (no continue-on-
remaining-legs).

### 6.5 Regulation-time settlement (full-tournament unlock)

Single bets are group-stage-only today because knockout markets settle on the **90-minute**
result, while the stored `score1`/`score2` (`raw.goals`) include extra-time goals and
`winnerCode` is the team that **advanced** (after ET/penalties). Grading 1x2/ou25/cs/cards
against those mis-settles every knockout market except `fh1x2`.

**Fix — grade on regulation time:**

- **Capture** (`mapFixture` in `api/src/providers/mapping.js`): add
  `regScore1 = raw.score?.fulltime?.home ?? null`, `regScore2 = raw.score?.fulltime?.away ?? null`.
  These populate at full-time (90'); during a live match they're `null`, so `resolveBet`
  returns `null` and the bet stays open (correct).
- **New helper** `regulationResult(f)` → `'HOME' | 'AWAY' | 'DRAW' | null` from
  `regScore1`/`regScore2` (draw when level). It does **not** consult `winnerCode`.
  `fixtureResult(f)` (the `winnerCode`-based "who advanced") stays as-is for **rewards/bracket
  display** (`grantMatchRewards` still pays the team that truly won).
- **`resolveBet` internals:**
  - `1x2` → `regulationResult(f)` (was `fixtureResult`).
  - `ou25` → `regScore1 + regScore2` (was `score1 + score2`).
  - `cs` → `` `${regScore1}:${regScore2}` `` (was `score1:score2`).
  - `cards` → count `events` of `type==='card'` with `(e.minute ?? 0) ≤ 90` (regulation +
    stoppage only; ET cards excluded).
  - `fh1x2` → unchanged (half-time is unaffected by ET).
- **Lift the gate:** remove the `stage === 'group'` check from `POST /api/bet` **and** the new
  `POST /api/parlay`, and the `f.stage === 'group'` filters in the web place-a-bet list and
  bet-detail screens. Bettability is now purely "upcoming + has odds".

For group-stage fixtures `regScore* === score*`, so existing group singles (and their tests,
once fixtures carry `regScore*`) settle identically — this change is behaviour-preserving for
group and merely **correct** for knockout.

## 7. Leg validity & betting-window guards

A betslip holds legs over time, so a fixture can kick off (close) between **adding** a leg
and **placing**. Validation happens at every stage, not just the final POST.

**"Bettable" predicate (one shared definition):** a fixture is bettable iff it **exists**
AND `status === 'upcoming'` AND the chosen market/selection **still has odds**. (No stage
clause — full tournament; an unpriced/TBD fixture fails the odds check.)

- **Add-time (client):** the odds button only toggles a leg into the slip if the fixture is
  currently bettable. (Buttons already render only for upcoming fixtures with odds; guard
  explicitly so a half-stale list can't seed a bad leg.)
- **While in the slip (client, reactive):** each leg re-derives `bettable` from live
  `S.fixture(id)` data (TanStack Query refresh + SSE `coins`/fixture invalidation keep it
  current). When a leg goes non-bettable — **kickoff, final, pruned, or odds removed** — the
  slip flags that leg ("Closed" / "Unavailable") and **disables Place** until the user
  removes the invalid leg(s). Applies to a 1-leg single too.
- **Explicit closed-event notice (decision #11):** when the user **opens the betslip**, if any
  leg is non-bettable the sheet shows a prominent notice at the top (e.g. *"1 selection is no
  longer available — remove it to place"*) naming the closed leg(s). The same notice is shown
  **on a submit attempt** while a closed leg is present (in addition to the disabled Place
  button), so the block is never silent. A leg flipping to closed while the sheet is open
  surfaces the notice reactively.
- **Place-time (server, authoritative — wins all races):** `POST /api/parlay` re-validates
  every leg inside the transaction. On any failure it places **nothing** and returns the
  per-leg error code (`fixture_not_found`, `leg_betting_closed`, `leg_no_odds`) or
  `duplicate_fixture`. The client maps the code → highlights that leg and prompts removal. So
  even if a match kicks off in the split-second before submit, the bet is rejected atomically.

**Odds drift:** the slip's odds/payout are a **preview**. The server computes `combinedOdds`
from the **latest stored odds** at placement. If any leg's odds moved since it was added, the
slip shows a subtle "odds updated" note and refreshes the payout preview, but the bet still
places (decision #6).

## 8. Frontend

State stays the existing hybrid: module store + TanStack Query.

### New `web/src/betslip.js` (mirrors `coins.js`)

In-memory module store with a `useBetslip()` hook:
- `legs[]` — each `{ fixtureId, market, selection, line, odds, book, label, bettable }`.
- `toggle(leg)`, `remove(key)`, `clear()`, `has(fixtureId, market, selection)`, `count`.
- `combinedOdds` = `Π(legOdds)`; `payout(stake)` = `round(stake × combinedOdds)`.
- **One leg per fixture:** adding a leg whose `fixtureId` already exists **replaces** that
  leg (picking another market on the same match swaps it).
- Re-derives each leg's `bettable` flag from live fixture data; subscribes to fixture-data
  changes so a kicked-off match flips a leg to closed without manual refresh.
- In-memory only (v1); a reload clears the slip.

### Odds buttons (`screens-coins.jsx` place-a-bet list + `screens-bet-detail.jsx`)

Now **toggle a leg into the betslip** and show a selected state, instead of opening the
single-bet sheet immediately. Tapping a selected button removes it. **Drop the
`f.stage === 'group'` filters** in both screens so upcoming knockout fixtures with odds also
appear (§6.5).

### Floating betslip pill + `BetslipSheet` (new)

A floating pill shows leg count + combined odds and opens `BetslipSheet`, which **reuses**
`StakePad`, the quick-add chips, and the payout preview:
- A **closed-event notice** banner at the top whenever any leg is non-bettable (shown on open
  and on a blocked submit — decision #11), naming the closed leg(s).
- Lists legs, each with a **remove (✕) control**, each showing its own `bettable` state
  (closed legs visually distinct).
- One stake input; live combined-odds + payout preview (with the "odds updated" note when
  drift is detected).
- **Place button gated** while any leg is non-bettable or `count < 1`; tapping it (or
  attempting submit) while blocked re-surfaces the closed-event notice rather than failing
  silently.
- On Place: **1 leg → existing `placeBet` single path; 2+ legs → new `placeParlay`.**

### `coins.js` + `api/client.js`

- `client.js`: add `postParlay(legs, stake)`; `fetchWallet` now also returns `parlays`.
- `coins.js`: add **`placeParlay(legs, stake)`** — optimistic: debit stake + prepend a
  `pending_*` open parlay to a `wallet.parlays` list, call `postParlay`, swap the pending
  row for the server row, **roll back on failure** (and on a per-leg server error, surface
  which leg failed so `BetslipSheet` can flag it). `setWalletData` ingests `parlays`.

### My Bets + Statement

- **My Bets** renders **parlay cards** (leg list, per-leg won/lost pills, overall status +
  payout) alongside single-bet rows, sorted by `placedAt`. Reuses `betLabels`.
- **Statement** labels parlay ledger rows "Multi · N legs" (stake/payout/refund already
  appear, keyed by `parlayId`).

### Gating

`canWager()` (`!!me && me.adult !== false && !isOptedOut()`) already hides the whole Wagers
tab for opted-out users and minors, so no extra gating is needed for the betslip.

## 9. Testing (TDD throughout)

**API (`api/test/`):**
- `parlay.test.js` — placement: happy 2-leg + 3-leg (mixed group/knockout legs),
  `combinedOdds`/`potentialPayout` math, `too_few_legs`, `duplicate_fixture`,
  `leg_betting_closed`, `leg_no_odds`, `minor_not_allowed`, `insufficient_funds`.
- `parlay-settle.test.js` — one leg lost → parlay `lost` immediately; all legs won → `won` +
  payout ledger on the last fixture; stays `open` until the last leg; idempotent
  re-settlement; `settleStaleBets` sweeps a cross-fixture parlay; prune → refund + `refunded`.
- `coins-settle.test.js` (extend) — **regulation-time grading** (§6.5): a knockout fixture
  level after 90' but won on penalties settles `1x2` DRAW = win and the penalty-winner
  HOME/AWAY = loss; `ou25`/`cs` grade on `regScore*` not ET-inclusive `score*`; `cards`
  counts only `minute ≤ 90` events; a group fixture (`regScore* === score*`) is unchanged.
  `regulationResult` unit cases.
- `mapping.test.js` (extend) — `mapFixture` captures `regScore1/regScore2` from
  `raw.score.fulltime`.
- Update the existing single-bet `coins.test.js` fixtures to carry `regScore*`; assert the
  group-only gate is gone (a knockout single is now accepted) and that the shared
  `walletFor`/`GET /api/coins` change applies `parlayId IS NULL` (legs don't leak into `bets`).

**Web (`web/src/`):**
- `betslip.test.js` — add/remove/toggle, replace-same-fixture, `combinedOdds`, min-2-to-be-a-
  parlay, `bettable` flips when fixture data changes.
- `BetslipSheet` test — renders legs, removable legs, **closed-event notice on open and on
  blocked submit**, gates Place on a closed leg, shows the "odds updated" note, routes 1 leg →
  single and 2+ → parlay.
- `coins.test.js` (extend) — `placeParlay` optimistic debit + pending row + rollback;
  per-leg server error flags the right leg.
- My Bets parlay-card render test; assert knockout fixtures now appear in the place-a-bet list.

## 10. Plan decomposition

This is one design but decomposes into sequential plan slices (the `writing-plans` step will
detail each against the real code):

0. **Regulation-time settlement + full-tournament unlock (foundation)** — `fixture.regScore*`
   columns + backfill, `mapFixture` capture, `regulationResult` helper, `resolveBet` rewrite,
   remove the `stage === 'group'` gate (single route + web filters). Lands first because
   parlays depend on knockout legs settling correctly; it's behaviour-preserving for group.
1. **DB + storage** — migration (`parlay` table + `bet.parlayId`), `serializeParlay`,
   `walletFor` `parlayId IS NULL` filter.
2. **`POST /api/parlay` + wallet read** — placement, per-leg validation + error codes,
   advisory-lock transaction, `GET /api/coins` `parlays`.
3. **Settlement (parlay rollup)** — `settleBets` leg branch, `settleParlay`, `settleStaleBets`
   parlay sweep, prune → refund.
4. **Betslip store + UI** — `betslip.js`, odds-button toggling, floating pill, `BetslipSheet`
   (removable legs + closed-event notice), `placeParlay` optimistic store.
5. **My Bets + Statement** — parlay cards, statement labels.

## 11. Non-goals (YAGNI)

- Cash-out / partial cash-out.
- Editing or cancelling a placed parlay.
- Void-leg tolerance (continue on remaining legs) — pruned legs refund the whole parlay.
- Same-fixture multi-leg / correlated parlays (one leg per fixture).
- localStorage persistence of the slip across reloads.
- Maximum leg cap.
- Penalty-shootout / extra-time betting markets (settlement is always regulation-time; we
  don't add "to qualify" or ET markets).
