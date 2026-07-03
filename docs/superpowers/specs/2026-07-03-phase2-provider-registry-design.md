# Phase 2 — Provider Registry + NBA Proof: Design

**Status:** Approved 2026-07-03 (owner decisions: NBA scope = api/worker-only proof,
web renders NBA as-is; NBA is baseline-sync-only — live polling stays football
until a paid feed tier). Implements phase 2 of the feasibility read
(`2026-07-01-multi-sport-sweep-platform-feasibility.md` §4, §8).

**Plan-time refinements (2026-07-03, recorded per plan approval):**
`fetchResults(ids)` drops the `comp` param (neither API needs it for id lookups);
NBA competitor `meta` carries `{conference}` only (division unconsumed — YAGNI);
per-sport event detail comes from an adapter method `baseDetail(mappedGame)` instead
of a sport fork inside `syncBaseline`; `mapStanding` (both sports) returns
`{providerTeamId, group, rank, pts, stats}` so the ranking upsert is shared.

**Inputs:** Phase 1 core schema (merged; api on competition/competitor/event/ranking,
wire contract frozen, web 436 untouched). Phase-2 blocking gate landed
(`eb3b233`..`b6b2c10`): per-competition seasonAnchor, competition-scoped event
lookups, required prune scope. NBA feed shape verified live —
`2026-07-03-nba-feed-shape.md` (league 12, string seasons, no draws, no odds,
free tier = seasons 2022–2024, `ids=` batching paid-gated).

## 1. Approach

One base adapter + per-sport field maps over the API-Sports family (spec §4 —
locked). The registry hands the worker/CLI an adapter per `competition.provider`;
sport-specific shape lives in a map object, soccer-only feed features become
optional capability methods that consumers probe. NBA proves the abstraction:
`hasDraws=false` flows feed → winnerCode → support validation → settlement,
rankings arrive `league_topN`-shaped, and the whole thing runs off baseline sync.

Rejected: per-sport ground-up adapters (the two APIs are near-identical —
duplication with no payoff); a vendor-neutral provider abstraction (explicitly
deferred by the feasibility read — API-Sports is committed, `competition.provider`
keeps the door open).

## 2. Registry + interface

`api/src/providers/registry.js`:

- `providerFor(competition)` → adapter instance, keyed by `competition.provider`
  (`'apifootball' | 'apibasketball'`), cached per provider, constructed with
  `process.env.API_FOOTBALL_KEY` (one API-Sports key works across sport APIs —
  verified live). Unknown provider → loud throw.

Adapter interface (spec §4 names; `comp` = the competition row):

```
fetchCompetitions()            // catalog: /leagues for this sport API
fetchCompetitors(comp)         // teams
fetchSchedule(comp)            // full season schedule incl. played results
fetchResults(comp, ids)        // targeted refresh of specific events
fetchStandings(comp)           // provider table(s)
resultToWinnerCode(game)       // mapped game → 'HOME'|'AWAY'|'DRAW'|null
```

`fetchResults` is the targeted-refresh method both sports implement: football
batches `/fixtures?ids=` (≤20), basketball loops single `id=` (free tier has no
`ids=`; a paid key can switch to batching later).

Capability extras (football only today, probed with `provider.fetchX?.()`):
`fetchLive`, `fetchOdds`, `fetchPredictions`, `fetchLineups`, `fetchEvents`,
`fetchStatistics`, `fetchSquad`. **The live tick gates on capability** — no
`fetchLive` → competition skipped by the live loop. NBA baseline-only falls
out with zero configuration.

## 3. Base adapter + field maps

- `api/src/providers/api-sports-base.js` — the HTTP get/retry/backoff/envelope
  loop extracted from `api-football-provider.js`, plus the six interface methods
  implemented once over a map.
- `api/src/providers/maps/football.js` — wraps the existing `mapping.js`
  functions; base URL `v3.football.api-sports.io`, paths `/fixtures`,
  integer season.
- `api/src/providers/maps/basketball.js` — new. Base URL
  `v1.basketball.api-sports.io`, paths `/games`; string season
  (`"2023-2024"`); map per the verified shape doc:
  - game → event: `scores.*.total` → score1/2; `quarter_1..4`/`over_time` →
    `detail.quarters`/`detail.ot`; `week` string → playoff `stage`
    (`'NBA - Quarter-finals'` etc. → non-`group` stage), regular season →
    `stage 'group'` (the inherited default; web renders it oddly by decision);
    status map `NS→upcoming`, `Q1..Q4|OT|BT|HT→live`, `FT|AOT→final`.
  - teams: drop the All-Star `East`/`West` rows (they also appear as games —
    schedule rows whose teams aren't in the competitor set are dropped, loud
    log, not an assert — All-Star game is expected noise).
  - standings: **conference groups only** (each team appears twice — conference
    + division; division rows dropped); `rank = position`, `points = 0`
    (NBA tables rank by win%, not points), `stats = {played, win, loss, pf, pa,
    pct}` jsonb.
- `api-football-provider.js` is ported behind the interface (base + football map
  + capability extras). Method names change at the call sites (baseline-sync,
  live-poller, worker, CLI runners); no back-compat shim — small codebase,
  rename cleanly.
- `winnerCode`: base implements `resultToWinnerCode` from the map; for
  `hasDraws=false` sports a drawn final **throws loud** (a tied NBA final is
  corrupt feed data, never a legal result). `sports.js` consumer #1.

## 4. Baseline sync generalization + newly-final chain

`syncBaseline(db, provider, competition)` (signature: competition row replaces
`{season, competitionId}` — season comes from `competition.season`, killing the
worker's global `WC_SEASON`):

- Shared spine: fetchSchedule + fetchStandings → upsert `event` (detailMerge) +
  `ranking`, prune + dependent-row cleanup (already competition-scoped, gate
  item 3), syncLog row.
- Football-only enrichments become capability-gated steps: crosswalk
  assert (curated codes), `computeFlags` (derby/doubleOwner), odds/predictions.
  NBA resolves provider ids → codes from `competitor.providerId` the same way,
  but reconciliation is feed-born (§5), so the loud "run crosswalk:sync" assert
  applies only where a curated roster exists (football).
- **Newly-final detection moves into baseline:** the upsert diffs prior status
  and `syncBaseline` returns `newlyFinal: [eventIds]`. The worker fires the
  existing chain on them — `settleBets` + `grantMatchRewards` per event,
  `recomputeStandings` only for sports it understands (football; NBA rankings
  are provider-authoritative). This is the NBA settlement path AND closes an
  inherited football gap: finals arriving via baseline (missed live window)
  settled bets via the stale sweeper but never granted match rewards.

## 5. Competitor sync from the feed

New `syncCompetitors(db, provider, competition)`: upsert `competitor` rows
straight from `fetchCompetitors` + conference/division from `fetchStandings` —
`code = slug(team name)` (`'oklahoma-city-thunder'` — stable, collision-free,
wire-safe), `providerId` set directly, `logo` from feed, `color` derived
deterministically (hash → palette; web needs a color), `meta = {conference,
division}`. Delete competitors that left the feed (same ownership/ranking
cleanup as `sync-teams`). Football's curated seed + reconcile-teams path is
untouched — it IS the reference implementation's roster behavior.

## 6. Provisioning (CLI, no UI — P3-compatible)

`npm run competition:add -w api -- <provider> <leagueId> <season>`:
catalog lookup via `fetchCompetitions` (validates the league id, takes
name/logo), insert `competition` row (`format: 'league'` for NBA; id
`<provider>:<leagueId>:<season>`), then `syncCompetitors` + `syncBaseline`.
Loud guards: unknown provider/league, empty fetches. Binding a sweep uses the
existing `POST /api/super/sweeps` with `competitionId`. The catalog UI stays
P3; `fetchCompetitions` existing on the interface is what keeps it unblocked.

## 7. hasDraws end to end (sports.js consumers)

1. `resultToWinnerCode` — never `'DRAW'` for `hasDraws=false`; tied final throws.
2. `POST /api/support` — a `'DRAW'` pick 400s (`invalid_team`) when the sweep's
   competition sport has no draws; checked only when the pick is `'DRAW'`
   (one competition lookup on that path; football wire behavior unchanged).
3. `recomputeStandings` — early-return for non-football sports (provider
   standings are authoritative for NBA).

## 8. Worker

`baseline()` resolves `providerFor(competition)` per iteration (competition row
fetched with it) instead of the module-level football provider; `WC_SEASON`
dies. The live tick's per-competition body starts with the capability gate
(§2). The newly-final chain from §4 runs after each baseline sync. Settle-stale
sweeper unchanged (already sport-agnostic — winnerCode-based).

## 9. Error handling

Inherited patterns: syncLog row per outcome, loud asserts on unresolvable
provider ids (football), throw on drawn finals in no-draw sports, CLI guards
print-and-exit non-zero. Baseline failure for one competition never blocks the
others (existing try/catch per iteration).

## 10. Testing

- Strict TDD; testcontainers as today.
- Live captures from the shape verification become
  `api/test/fixtures/apibasketball/*.json` (leagues/teams/games/standings,
  trimmed); the recorded-provider pattern extends to basketball.
- Key tests: base-adapter unit (retry/envelope/param mapping per sport);
  basketball map (status/score/stage/All-Star filter/conference standings);
  `resultToWinnerCode` 2-way + tied-final throw; `syncCompetitors` upsert +
  delete + slug codes; NBA baseline into event/ranking; newly-final return →
  settle+rewards fire (and football recompute still fires); support DRAW
  rejection for NBA sweep; **end-to-end proof**: NBA competition from recorded
  feed → sweep bound → ownership + support + bet → games flip final → 2-way
  settlement + rankings.
- Dev DB: real NBA 2023-2024 seeded via the CLI against the live feed
  (~4 requests; free-tier window).
- Web suite passes **unmodified** (436) — owner decision: api/worker-only proof.

## 11. Out of scope

Catalog/self-serve UI + auth (P3), Stripe (P4), NBA odds/markets — the feed has
none; Wagering market spine is P5 (NBA sweeps simply have no odds → no bets
placeable, wagering inert), NBA live polling (paid tier), web reskin/sport
vocabulary (P6), non-NBA second sports (AFL/NHL verified available, not built).
