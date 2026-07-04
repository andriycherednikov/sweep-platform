# P5 feed-reality check — odds shape per API + basketball verdict

**Status:** live-verified 2026-07-04 (P3 catalog-shape precedent). Spend:
basketball ~4 req of 100/day (free key quota), football 2 req (Pro key, shared
with the live WC app). Raw captures promoted to fixtures where usable.

## Football — v3.football `/odds?fixture=<id>`

Verified against fixture **1567824** (WC 2026 SF, Canada v Morocco, kickoff
2026-07-04T17:00Z): 13 bookmakers, ~200 bet types. Raw capture:
`api/test/fixtures/apifootball/odds-spine-live.json` (the old `odds.json` is a
synthetic trim — Match Winner + Goals O/U only, **no handicap**; use the live
capture for spine work).

Spine bet ids (football API):

| Our market | Bet id | Bet name | Values shape |
|---|---|---|---|
| 1X2 (3-way ML) | 1 | Match Winner | `Home / Draw / Away` |
| Moneyline (2-way) | 2 | Home/Away | `Home / Away` |
| Totals O/U | 5 | Goals Over/Under | `Over 2.5` / `Under 2.5` (many lines) |
| Handicap (asian) | 4 | Asian Handicap | `Home +0.5` / `Away +0.5` (many lines) |
| Handicap (3-way euro) | 9 | Handicap Result | `Home -1 / Draw -1 / Away -1` |

Odds are **strings** (`"4.50"`); the line is embedded in the value string.
Existing `mapMarkets` already parses ids 1 and 5 (fixed 2.5 line); spine gap =
handicap + 2-way ML + line selection.

## Basketball — v1.basketball `/odds?game=<id>`

Taxonomy from `/bets` (245 types, capture:
`api/test/fixtures/apibasketball/bets.json`) — the spine exists, **different
ids than football**:

| Our market | Bet id | Bet name |
|---|---|---|
| 3-way (n/a for NBA) | 1 | 3Way Result |
| Moneyline (2-way) | 2 | Home/Away |
| Handicap | 3 | Asian Handicap |
| Totals O/U | 4 | Over/Under |

Same envelope as football (`bookmakers[].bets[].values[{value, odd}]`, string
odds, line-in-value).

## Basketball verdict — no odds reachable on the current (free) plan

- `/odds` and `/bets` are **not plan-gated**: 200, `errors: []` on the free key.
- `/odds?game=400924` (2024 Finals, a synced dev-DB game) → **0 results**.
- `/odds?league=12&season=2023-2024` (league-level) → **0 results**.
- Root cause is structural, not a single missing flag: API-Sports odds are
  **pre-match only** (published days before a game, purged after), and the
  free-tier season window (2022–2024, `registry.js`) contains only finished
  seasons. Seasons we can sync have no odds; seasons with odds we can't sync.
  The catalog's `odds:false` on every free-window NBA season agrees.
- Even a paid basketball key (~$19/mo per `2026-07-04-p4-unit-economics.md`)
  buys nothing until the NBA is in season (next games ~Oct 2026) — odds only
  exist near kickoff.

**Consequence for the grading registry:** bet ids differ per API, so grading
must key on OUR normalized market types (with `hasDraws` deciding
1X2-vs-moneyline); each provider's odds mapping owns the feed-id → market-type
translation, as football's `mapMarkets` already does.
