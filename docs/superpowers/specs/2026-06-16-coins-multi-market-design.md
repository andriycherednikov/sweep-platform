# Coins — multi-market betting + UX redesign (design spec)

Date: 2026-06-16 · Status: approved, ready to plan · Branch: `feat/coins-betting`

## Context

The Coins feature (play-money betting) shipped with a single market — Match Winner (1X2),
group stage only — and a flat list UI. This spec expands it to **five Pinnacle-sourced
markets per fixture** and redesigns the screen: chronological day-split fixture list with
flags, a **Place a bet / My bets** tab split, and a **fixture bet-detail** view exposing
all markets. It builds directly on the existing ledger/bet/settlement backend.

Researched live against API-Football (Pro): there is **no bet-grading/settlement feed** —
the odds payload is prices only (`{id,name,values}`). We already ingest `/fixtures`
(final score, `teams.*.winner`, HT/FT/ET/PEN breakdown, goal/card events), which is enough
to settle the chosen markets ourselves.

## Single-bookmaker rule

To keep pricing consistent and credible, **all markets for a given fixture come from one
bookmaker**: Pinnacle when present, else the next book in the existing rank
(`['Pinnacle','Bet365', …]`) that is present for that fixture. A market the chosen book
doesn't carry is omitted; the UI renders whatever exists.

## Markets (5)

All settle from data we have or will capture. Lines are `.5` so there is no push/void.

| Key | Market (provider name) | Selections | Settles from |
|---|---|---|---|
| `1x2` | Match Winner | `HOME` / `DRAW` / `AWAY` | final result (`score1` vs `score2`) |
| `ou25` | Goals Over/Under (2.5 line) | `OVER` / `UNDER` | `score1 + score2` vs 2.5 |
| `cards` | Cards Over/Under (preferred .5 line, default 3.5) | `OVER` / `UNDER` | count of `card` events vs the bet's line |
| `fh1x2` | First Half Winner | `HOME` / `DRAW` / `AWAY` | half-time score |
| `cs` | Correct Score (provider "Exact Score") | `"H:A"` scoreline | `\`${score1}:${score2}\`` == selection |

Provider value formats (verified): Goals/Cards values like `"Over 2.5"`/`"Under 2.5"`;
Exact Score values like `"2:1"` (121 scorelines). Dropped from the user's wishlist because
Pinnacle doesn't price them for WC fixtures: **Both Teams To Score** and **First Team to
Score**. **Knockouts remain out of scope** (the 1X2/markets are 90-min; settlement uses the
group result).

## Data model

### `fixture` (modify)
- **Add `markets` jsonb** — normalized, the source of truth for offered prices:
  ```json
  {
    "1x2":   { "label": "Match Winner",      "book": "Pinnacle", "selections": [
                 {"key":"HOME","label":"Croatia","odds":2.32},
                 {"key":"DRAW","label":"Draw","odds":3.53},
                 {"key":"AWAY","label":"Ghana","odds":2.98} ] },
    "ou25":  { "label": "Over/Under 2.5", "line": 2.5, "book":"Pinnacle", "selections":[
                 {"key":"OVER","label":"Over 2.5","odds":2.25},
                 {"key":"UNDER","label":"Under 2.5","odds":1.70} ] },
    "cards": { "label": "Cards Over/Under", "line": 3.5, "book":"Pinnacle", "selections":[…] },
    "fh1x2": { "label": "First Half Result", "book":"Pinnacle", "selections":[HOME/DRAW/AWAY] },
    "cs":    { "label": "Correct Score", "book":"Pinnacle", "selections":[ {"key":"2:1","label":"2-1","odds":8.5}, … ] }
  }
  ```
- **Add `htScore1`, `htScore2`** (integer, nullable) — half-time score from `score.halftime`.
- **Drop `oddsHome/oddsDraw/oddsAway/oddsBook`** (the just-added single-market columns; superseded by `markets`). Keep `probA/probD/probB` (ProbBar) and `winnerCode`.

### `bet` (modify)
- **Add `market`** (text, NOT NULL, default `'1x2'`) — the market key.
- **Add `line`** (numeric, nullable) — the O/U line locked at placement (for `ou25`/`cards`).
- `selection` stays text but is now market-specific (`HOME`/`OVER`/`"2:1"`/…). `oddsDecimal`,
  `potentialPayout`, `status`, etc. unchanged.

A Drizzle migration adds the new columns and drops the four `odds_*` columns.

## Provider & worker

- **`mapMarkets(oddsResponse)`** (`providers/mapping.js`) → picks the single best-ranked
  bookmaker present, then extracts the 5 markets into the normalized shape: `1x2` and
  `fh1x2` from Home/Draw/Away; `ou25` by selecting the `Over 2.5`/`Under 2.5` values;
  `cards` by selecting a preferred `.5` line (3.5 → 4.5 → 2.5) Over/Under pair; `cs` from all
  Exact Score values. Returns `{ markets, book }` or `null`. Also retains the implied `{a,d,b}`
  percents (from the 1X2 prices) so `probA/D/B` and the ProbBar keep working.
- **`mapFixture`** additionally reads `raw.score?.halftime` → `htScore1/htScore2` and keeps
  the existing `winnerSide`.
- **`baseline-sync`** persists `markets` (when freshly fetched) + `htScore1/2`. Cadence
  unchanged (~4×/day pre-match); bets lock the price at placement.
- **`serialize.js`**: fixture exposes `markets: f.markets ?? null` (drops the `odds` field).
- **`assemble.js`**: carry `markets` onto the SWEEP fixture shape.

## Settlement

`resolveBet(market, selection, line, fixture)` → `'won' | 'lost'`:
- `1x2`  → `fixtureResult(fixture) === selection`
- `ou25` → `total = score1+score2`; `OVER` wins iff `total > 2.5`, else `UNDER`
- `cards`→ `n = (fixture.events||[]).filter(e=>e.type==='card').length`; `OVER` iff `n > line`
- `fh1x2`→ half-time result from `htScore1/htScore2` (fallback: derive from goal events with
  `minute <= 45`); `=== selection`
- `cs`   → `\`${score1}:${score2}\` === selection`

`settleBets` keeps its current shape (claim each open bet atomically, payout on win, idempotent,
SSE per sweep) but resolves each bet via `resolveBet(b.market, b.selection, b.line, f)` instead
of the 1X2-only check. If a market's required data is missing (e.g. `htScore` null and no goal
events) the bet is left `open` rather than mis-settled.

## API

- **`POST /api/bet`** body gains `market` (enum of the 5 keys; default `1x2` if omitted) and
  uses `selection` as the market key. Validation: the fixture's stored `markets[market]` must
  exist and contain `selection`; lock that selection's `odds` and (for `ou25`/`cards`) the
  market `line`. Group-stage-only, advisory-lock balance check, etc. all unchanged.
- **`GET /api/coins`**: bets now serialize `market` + `line` alongside the existing fields.

## Frontend (`web/`)

- **`screens-coins.jsx`** — two sub-tabs under the pinned wallet header:
  - **Place a bet**: fixtures filtered to `upcoming && markets?.['1x2'] && stage==='group'`,
    **grouped by `dayKey` with Schedule-style day headers** (reuse the `screens-main.jsx`
    grouping), each row = **flags** (`<Flag/>`) + team names + book + inline **1X2** odds
    buttons (one-tap H2H). Tapping the row (not a button) opens the bet-detail overlay.
  - **My bets**: All / Open / Settled filter over `myWallet().bets`; each row shows market
    label + selection + stake + odds + status pill (+ payout on win).
- **Bet-detail overlay** (new, `.overlay`/`.sheet` pattern) — match header (flags, names,
  KO), then one section per market in `fixture.markets` with selection buttons → the existing
  bet sheet (stake, live payout, place). Correct Score lists scorelines sorted by odds
  ascending, capped ~12 with a "more" expander.
- **`coins.js`** `placeBet(fixtureId, market, selection)` reads the locked odds/line from
  `fixture.markets[market]`; posts `{ market, selection }`. Optimistic + rollback unchanged.
- Navigation: a new `betdetail` overlay in `App.jsx` (id = fixtureId), reachable from the
  Coins list. Bottom-nav/tab unchanged.

## Seed (dev)

`generate.js`/`seed.js` emit all 5 markets per fixture (1X2/FH from the implied percents;
`ou25`/`cards` with plausible derived odds; a small `cs` set of common scorelines) and set
`htScore1/2` for live/final fixtures, so the full multi-market flow works locally without the
worker.

## Testing (TDD, Vitest + Testcontainers)

- `mapMarkets`: single-book selection + fallback; correct 2.5 goals line; preferred cards
  line; exact-score list; omits absent markets; returns implied `{a,d,b}`.
- `mapFixture`: HT score captured.
- `resolveBet`: a table of cases per market (win/lose, the cards-from-events count, HT result,
  exact-score match).
- `settleBets`: a multi-market fixture settles each bet correctly; idempotent.
- `POST /api/bet`: validates `(market, selection)` against stored markets; rejects unknown
  market/selection; locks odds + line.
- Web: day-split + flags render; tab switch; bet-detail overlay opens with markets; placing a
  non-1X2 bet posts the right `{market, selection}`.

## Out of scope (now)

Knockout markets / "To Qualify"; Both Teams To Score & First Team to Score (not Pinnacle-priced);
multiple O/U lines; in-play settlement; cash-out.
