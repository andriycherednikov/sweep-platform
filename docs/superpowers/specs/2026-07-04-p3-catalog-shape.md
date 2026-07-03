# Catalog shape — verified live against both API-Sports APIs

**Status:** Verified 2026-07-04 with the project's key. 4 live requests total
(`/status` + `/leagues` on each API). Feeds the Phase-3 catalog design
(feasibility spec §5, §8 phase 3). Raw captures in the session scratchpad;
`api/test/fixtures/apifootball/leagues.json` rebuilt from the live capture
(league 1 + 39, two seasons each, real coverage flags) — closes the
"live-verify the hand-built fixture" follow-up.

## Plan reality on this key (changes the budget math)

| API | Plan | Daily limit | Used at check | Season window |
|---|---|---|---|---|
| Football v3 | **Pro** (renews 2026-07-09) | 7,500/day | 1,516 | unrestricted |
| Basketball v1 | Free | 100/day | 10 | **2022–2024 only** |

- The football key is **shared with the live WC app** (upstream prod is polling
  the live World Cup on it right now — WC 2026 runs through 2026-07-07). Catalog
  work must stay polite on the football API too, but 1 call/refresh is noise.
- The basketball 100/day budget is the binding constraint and the reason for the
  phase rule: **catalog is persisted; nothing fetches provider catalogs per user
  request.**

## /leagues response reality

| Concern | Football v3 | Basketball v1 |
|---|---|---|
| Rows | **1,235** leagues | **427** leagues |
| Payload | 2.9 MB | 713 KB |
| Paging | `paging {current:1, total:1}` — one page | **no `paging` key at all** — one response |
| Row shape | `{league:{id,name,type,logo}, country:{name,code,flag}, seasons[]}` | flat `{id,name,type,logo, country:{id,name,code,flag}, seasons[]}` |
| `type` values | `League` (780) / `Cup` (455) | `League` (230) / **`cup` lowercase** (197) — inconsistent casing within one API |
| Season key | `year` int + **`current` bool** | `season` — **mixed types**: string `"2024-2025"` (2,078) and int `2019` (1,453); **no `current` flag** — currency must be inferred from `start`/`end` dates |
| Coverage (per season) | `{fixtures{events,lineups,statistics_*}, standings, players, top_scorers, top_assists, top_cards, injuries, predictions, odds}` | `{games{statistics{teams,players}}, standings, players, odds}` |

## Filter survivors (2-team sport + standings coverage + season window)

Both APIs are 2-team sports throughout — the filter is coverage + window:

- **Football:** 1,230 leagues have a current season; **679** of those have
  `standings: true` on it; 125 also have odds.
- **Basketball:** **277** leagues have a season starting 2022–2024 with
  `standings: true`.
- ≈ **956 provisionable league-seasons** across the two providers today.

**Coverage-flag maturity trap:** a not-yet-started season reports pessimistic
coverage — Premier League `2026` (starts 2026-08-21) says `standings: false`
today while `2025` says `true`. A "current season + standings" filter silently
drops every league in its off-season. Consequences:
1. Filter/display per **league-season**, not per league.
2. The catalog needs **periodic refresh** (flags flip as seasons approach).
3. An off-season league is a valid pick for its *previous* (completed) season.

**Plan-gating is invisible in the feed:** NBA `2024-2025`/`2025-2026` advertise
`standings: true`, but the free basketball plan refuses seasons outside
2022–2024. The season-window filter must come from configuration (per-provider
plan knowledge), not from coverage flags.

## What this decides for the design

- **Persisted catalog: DB table, refreshed by a job/CLI** (not a cached JSON
  blob): ~1.7k league rows (seasons as jsonb) is trivial for Postgres, search
  wants indexes (sport/name/country), and provisioning must validate
  leagueId+season **against the persisted catalog** — `addCompetition` today
  calls `fetchCompetitions()` live per provision, which the budget rule forbids
  once users drive it.
- **Refresh cost: 2 requests total** (one `/leagues` per API), no paging loop.
  Daily refresh ≈ 2% of the basketball budget, ~0.03% of football's.
- `mapLeague` (both sports) currently drops `country` — the catalog needs it
  for search/display; extend the maps.
- `mapLeague` must also carry per-season `coverage.standings` (and normalize
  basketball's mixed season types via the existing `String(season)`).
- `format` inference (`type === 'League' ? 'league' : 'groups_then_ko'`)
  survives the casing mess by accident (basketball cups are `'cup'`, still
  ≠ `'League'`); leave it.
