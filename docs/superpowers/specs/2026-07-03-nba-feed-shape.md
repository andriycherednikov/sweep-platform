# NBA feed shape — verified live against v1.basketball.api-sports.io

**Status:** Verified 2026-07-03 with the project's API-Sports key (free tier, ~10 of
100 daily requests used). Feeds the Phase-2 provider-registry design
(feasibility spec §4). Raw responses captured during verification; shapes below
are from live data, not memory (the NRL scope decision died to memory).

## Verdict

**NBA is cleanly available.** League id **12**, seasons keyed as strings
(`"2023-2024"`), full standings + team/player statistics coverage from season
2023-2024 onward. Response envelope is identical to API-Football
(`get/parameters/errors/results/paging/response`), auth header identical
(`x-apisports-key`) — one key works across both APIs. The §4 "one base adapter +
per-sport field maps" bet holds.

## Endpoint / shape comparison

| Concern | API-Football (v3, league 1) | API-Basketball (v1, league 12) |
|---|---|---|
| Envelope | `{get, parameters, errors, results, paging, response}` | identical |
| Auth | `x-apisports-key` | identical (same key works) |
| Season key | integer `2026` | **string `"2023-2024"`** |
| Catalog | `/leagues` | `/leagues` (same shape: `{id, name, type, logo, country, seasons[]}` + per-season `coverage`) |
| Teams | `/teams?league&season` → `{team: {id, name, logo}, venue}` | `/teams?league&season` → **flat** `{id, name, logo, nationnal, country}` (no wrapper, no venue; note API's `nationnal` typo) |
| Schedule/results | `/fixtures?league&season` → `{fixture: {id, date, status, venue{name,city}}, league{round}, teams, goals{home,away}}` | `/games?league&season` → flat `{id, date, timestamp, stage, week, venue`(string)`, status{long,short,timer}, teams{home,away}, scores{home,away}}` |
| Score fields | `goals.home/away`, `score.halftime/fulltime/extratime/penalty` | `scores.home/away.{quarter_1..4, over_time, total}` |
| Final statuses | `FT`/`AET`/`PEN` | `FT`/`AOT` (1311 FT + 66 AOT observed; live: `Q1..Q4/OT/BT/HT`) |
| Per-id poll | `/fixtures?ids=a-b-c` (batch ≤20) | `/games?id=X` works free; **`ids=` batch exists but is paid-gated** |
| Standings | `/standings` → nested `league.standings[][]`, `{team, group, all{played,win,draw,lose,goals}, points}` | `/standings` → `response[0]` = flat array of 60 rows: `{position, stage, group{name}, team, games{played, win{total,percentage}, lose{total,percentage}}, points{for,against}, description}` |
| Draws | league table has `draw` column | **no draw concept**; 0 draws in 1377 games → `hasDraws=false` confirmed end to end |
| Round/stage | `league.round` string per fixture | `stage` null; playoff round lives in **`week`** (`"NBA - Quarter-finals"`, `"NBA - Semi-finals"`, `"NBA - Final"`); regular-season games have `week: null` |
| Odds | `/odds?fixture` (used today) | endpoint exists, but NBA coverage flag says **`odds: false` for every season** — Wagering's market spine for NBA can NOT come from this feed (Phase-5 flag) |
| Lineups/events | `/fixtures/lineups`, `/fixtures/events` | no equivalents; `/games/statistics/teams`, `/games/statistics/players` instead (coverage true from 2023-2024) |

## Per-sport quirks the adapter/field-maps must handle

1. **All-Star pollution:** `/teams?league=12&season=…` returns **32** rows — the 30
   franchises plus `"East"` and `"West"` All-Star squads. Competitor sync must
   filter them (they also appear as games in the schedule).
2. **Dual standings rows:** each team appears **twice** — once under its
   conference (`Western/Eastern Conference`, 15 rows each) and once under its
   division (Atlantic/Central/… , 5 rows each). Pick ONE grouping (conference)
   for `ranking`; `league_topN` reads `position` within it. W/L + points
   for/against → `stats` jsonb; `points.for/against` are season aggregates, not
   table points (there is no "points" column in NBA standings — rank by win%).
3. **Season string:** `competition.season` is already `text` — no schema change,
   but the football adapter's integer assumption dies at the registry boundary.
4. **winnerCode from totals:** `scores.*.total` + status `FT|AOT` → 2-way
   winner; the `'DRAW'` sentinel must be unreachable for basketball
   (`hasDraws=false` guard).
5. **Poller shape:** free tier has no `ids=` batching; paid tier has it. The
   registry's fetch-by-ids should batch on football, loop single `id=` (or poll
   by `date`+league) on basketball.

## Tier constraints observed (dev planning, not design)

- Free tier: seasons **2022–2024 only** ("Free plans do not have access to this
  season, try from 2022 to 2024"), 100 req/day, no `ids=` param. Phase-2
  development runs against **2023-2024** (complete season incl. playoffs:
  1377 games, finals done).
- Current-season (2025-2026 / 2026-2027) live sync requires a paid plan —
  already assumed by the waived feed-cost decision (feasibility §9).
- NBA Cup exists as a separate league (id 422) — out of scope, noted only so
  nobody wires it by accident when searching "NBA".
