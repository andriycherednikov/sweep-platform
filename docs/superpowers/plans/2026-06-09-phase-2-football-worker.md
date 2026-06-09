# Phase 2 — Football Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seeded placeholder fixtures/standings with real API-Football data, pulled by a long-running worker through a provider adapter, on two cadences (baseline + live), with idempotent upserts, a freshness/stale signal, and loud failure on ID mismatch — all testable offline against recorded JSON.

**Architecture:** The worker shares the `api/` workspace (same Drizzle schema + db client, different entrypoint `api/src/worker.js`). All network access sits behind a `FootballProvider` interface with one real implementation (`ApiFootballProvider`, native `fetch`) and one test double (`RecordedProvider`, returns captured JSON). A pure **mapping** layer turns raw API-Football v3 JSON into our domain rows; a pure **flags** layer computes derby/double-owner; `team_crosswalk` translates provider team ids → our `team.code` and **fails loudly** on any unresolved id. Baseline sync (a few times/day) upserts fixtures+standings+predictions and prunes stale fixtures; the live poller (`/fixtures?live=all`, windowed around kickoffs) updates scores/minute/status. Every run writes a `sync_log` row; the api exposes freshness via `GET /api/sync-status` (`stale:true` when the newest OK baseline is >18h old). The cache is the contract — any pull failure logs and leaves last-good data untouched.

**Tech Stack:** Node 22 (ESM, global `fetch`), Fastify 5, Drizzle ORM, `node-cron` (scheduler), Vitest + `@testcontainers/postgresql` (integration), plain Vitest (unit). API-Football **v3** (`https://v3.football.api-sports.io`), league `1` (World Cup), season `2026`.

---

## Context: what already exists (Phase 1, on `main`)

- `api/src/db/schema.js` — 11 tables. Relevant here:
  - `fixture { id(text PK), group, matchday, t1Code, t2Code, kickoffUtc(tstz), venue, city, status, score1, score2, minute, probA, probD, probB, stage(default 'group'), derby, doubleOwner, updatedAt }`
  - `standing { teamCode(text PK → team.code), played, win, draw, loss, gf, ga, pts, updatedAt }`
  - `syncLog { id(serial PK), ranAt(tstz default now), source, kind, status, counts(jsonb), error }`
  - `teamCrosswalk { teamCode(text PK → team.code), providerTeamId(integer, currently all NULL) }`
  - `team { code(PK), name, group, pool, color, strength, flagCode }`, `ownership { personId, teamCode }`, plus `watch`/`support` (empty until Phase 4).
- `api/src/db/client.js` — `createPool(connectionString?)`, `createDb(pool)`.
- `api/src/db/migrate.js` — `runMigrations(db)`; CLI `node src/db/migrate.js`.
- `api/src/seed/` — Phase 1 seed (placeholder fixtures `m0..m71`, standings, photos). The worker **supersedes** the fixture/standing data; seed remains useful for offline frontend work and tests.
- `api/src/app.js` — `buildApp(db, opts)`; registers `/api/health` + six read routes. We add `syncStatusRoutes` here.
- `api/test/helpers/global-setup.js` — boots one Postgres 16 container, runs migrations, seeds. `api/test/helpers/db.js` — `openTestDb()`.
- Tests run serially (`vitest.config.js`: `fileParallelism:false`, single shared container).

**SDK note (per project rule "check for an SDK first"):** API-Football has **no official Node SDK**; community wrappers exist but are thin, unofficial, and add little over `fetch`. The approved design (spec §4) deliberately puts a typed adapter behind our own interface so the cache stays the contract. We use native `fetch`. (Implementer: confirm no official SDK has shipped at build time; if one has, evaluate it behind the same interface.)

**Decisions locked for this phase (call out at review):**
- **Fixture PK becomes the provider fixture id** (as text), replacing seeded `m0..m71`. After a full successful fixture fetch, baseline sync **prunes** fixtures whose id is not in the fetched set. This is safe in Phase 2 (no `watch`/`support` rows exist yet — those arrive in Phase 4, by which point provider ids are the stable PKs).
- **`group`/`matchday`/`stage`** are parsed from API-Football's `league.round` (e.g. `"Group A - 1"`). Knockout rounds map to `stage='knockout'` and are out of scope for the read UI in this phase but must not crash the mapper.
- **Standings are stored as API-Football provides them** (official tiebreakers) — we never recompute.
- **Manual refresh is a CLI** (`npm run sync -w api`) in this phase. The authenticated `POST /api/admin/sync` HTTP route is deferred to Phase 5 (admin auth) to avoid shipping an unauthenticated mutating endpoint.
- **Crosswalk seeding** (provider team ids) is its own task with an offline-tested matcher; the one online step (capturing `/teams` for league 1 / season 2026) is a documented runbook requiring the human-provided `API_FOOTBALL_KEY`.

---

## File Structure

```
api/
  package.json                         + node-cron dep; + scripts: sync, crosswalk:sync, worker
  src/
    providers/
      football-provider.js             JSDoc typedefs: FootballProvider + Raw*/domain shapes (interface only)
      api-football-provider.js         ApiFootballProvider: fetch client (key header, retry/backoff) + endpoint calls
      mapping.js                       pure: mapStatus, parseRound, mapFixture, mapStanding, mapPrediction
      recorded-provider.js             test double: returns injected recorded JSON (implements the interface)
    worker/
      crosswalk.js                     resolveCrosswalk(db) → Map<providerTeamId, teamCode>; assertResolved(...)
      crosswalk-sync.js                fill teamCrosswalk.providerTeamId from provider /teams; report unmatched; CLI
      flags.js                         pure: computeFlags(fixtures, ownershipRows) → per-fixture {derby,doubleOwner}
      baseline-sync.js                 syncBaseline(db, provider, {season}) → upsert+prune+sync_log
      live-poller.js                   pollLive(db, provider) + kickoff-window helpers (windowAroundKickoffs, isLiveWindow)
      run-baseline.js                  CLI entry: build provider+db, run syncBaseline, exit
    routes/
      sync-status.js                   GET /api/sync-status → { stale, lastBaselineAt, lastLiveAt }
    worker.js                          long-running entry: node-cron baseline + windowed live interval
  test/
    fixtures/apifootball/              recorded JSON: fixtures.json, fixtures-live.json, standings.json,
                                       predictions.json, teams.json
    mapping.test.js                    unit (no DB)
    flags.test.js                      unit (no DB)
    crosswalk.test.js                  integration (resolver assert + crosswalk-sync matcher)
    baseline-sync.test.js              integration (idempotent upsert + prune + failure-leaves-last-good)
    live-poller.test.js                integration (window logic unit + live update integration)
    sync-status.test.js               integration (stale threshold)
```

---

## Task 1: Worker deps, recorded JSON, and the provider interface

**Files:**
- Modify: `api/package.json`
- Create: `api/src/providers/football-provider.js`, `api/src/providers/recorded-provider.js`
- Create: `api/test/fixtures/apifootball/{fixtures,fixtures-live,standings,predictions,teams}.json`

- [ ] **Step 1: Add `node-cron` and worker scripts to `api/package.json`**

Add to `dependencies`: `"node-cron": "^3.0.3"`. Add to `scripts`:
```json
    "worker": "node --env-file=../.env src/worker.js",
    "sync": "node --env-file=../.env src/worker/run-baseline.js",
    "crosswalk:sync": "node --env-file=../.env src/worker/crosswalk-sync.js"
```
Run: `npm install` (root). Expected: `node-cron` installed, lockfile updated, no version churn elsewhere.

- [ ] **Step 2: Create the recorded JSON samples** (representative API-Football **v3** shapes; the implementer should overwrite each with one real captured response once `API_FOOTBALL_KEY` is available — the v3 envelope is stable, so the mappers won't change).

`api/test/fixtures/apifootball/fixtures.json` — two group fixtures, one finished, one upcoming:
```json
{
  "response": [
    {
      "fixture": { "id": 9001, "date": "2026-06-13T03:30:00+00:00", "status": { "short": "FT", "elapsed": 90 }, "venue": { "name": "Estadio Akron", "city": "Guadalajara" } },
      "league": { "id": 1, "season": 2026, "round": "Group L - 1" },
      "teams": { "home": { "id": 3001, "name": "Croatia" }, "away": { "id": 3002, "name": "Belgium" } },
      "goals": { "home": 2, "away": 1 }
    },
    {
      "fixture": { "id": 9002, "date": "2026-06-16T09:00:00+00:00", "status": { "short": "NS", "elapsed": null }, "venue": { "name": "MetLife Stadium", "city": "New York / NJ" } },
      "league": { "id": 1, "season": 2026, "round": "Group L - 2" },
      "teams": { "home": { "id": 3001, "name": "Croatia" }, "away": { "id": 3003, "name": "Ghana" } },
      "goals": { "home": null, "away": null }
    }
  ]
}
```

`api/test/fixtures/apifootball/fixtures-live.json` — fixture 9002 now in-play:
```json
{
  "response": [
    {
      "fixture": { "id": 9002, "date": "2026-06-16T09:00:00+00:00", "status": { "short": "2H", "elapsed": 63 }, "venue": { "name": "MetLife Stadium", "city": "New York / NJ" } },
      "league": { "id": 1, "season": 2026, "round": "Group L - 2" },
      "teams": { "home": { "id": 3001, "name": "Croatia" }, "away": { "id": 3003, "name": "Ghana" } },
      "goals": { "home": 1, "away": 0 }
    }
  ]
}
```

`api/test/fixtures/apifootball/standings.json` — one group's table:
```json
{
  "response": [
    {
      "league": {
        "standings": [
          [
            { "team": { "id": 3001, "name": "Croatia" }, "all": { "played": 1, "win": 1, "draw": 0, "lose": 0, "goals": { "for": 2, "against": 1 } }, "points": 3 },
            { "team": { "id": 3002, "name": "Belgium" }, "all": { "played": 1, "win": 0, "draw": 0, "lose": 1, "goals": { "for": 1, "against": 2 } }, "points": 0 }
          ]
        ]
      }
    }
  ]
}
```

`api/test/fixtures/apifootball/predictions.json` — for one fixture:
```json
{ "response": [ { "predictions": { "percent": { "home": "55%", "draw": "25%", "away": "20%" } } } ] }
```

`api/test/fixtures/apifootball/teams.json` — for crosswalk matching:
```json
{
  "response": [
    { "team": { "id": 3001, "name": "Croatia", "code": "CRO", "country": "Croatia" } },
    { "team": { "id": 3002, "name": "Belgium", "code": "BEL", "country": "Belgium" } },
    { "team": { "id": 3003, "name": "Ghana", "code": "GHA", "country": "Ghana" } }
  ]
}
```

- [ ] **Step 3: Define the interface (JSDoc only — no runtime export needed beyond docs) `api/src/providers/football-provider.js`**

```js
/**
 * @typedef {Object} RawProb { a:number, d:number, b:number } as integer percents
 * @typedef {Object} DomainFixture
 * @property {string} id              provider fixture id, stringified
 * @property {string} group           e.g. 'L'  (parsed from league.round)
 * @property {number} matchday        e.g. 1
 * @property {string} stage           'group' | 'knockout'
 * @property {number} homeProviderId  provider team id (home)
 * @property {number} awayProviderId  provider team id (away)
 * @property {Date}   kickoffUtc
 * @property {string} venue
 * @property {string} city
 * @property {'upcoming'|'live'|'final'} status
 * @property {number|null} score1
 * @property {number|null} score2
 * @property {number|null} minute
 *
 * @typedef {Object} DomainStanding
 * @property {number} providerTeamId
 * @property {number} played @property {number} win @property {number} draw
 * @property {number} loss @property {number} gf @property {number} ga @property {number} pts
 *
 * @typedef {Object} DomainTeam { providerTeamId:number, name:string, code:string|null, country:string|null }
 *
 * A FootballProvider returns DOMAIN shapes (already mapped from raw JSON).
 * @typedef {Object} FootballProvider
 * @property {(season:number) => Promise<DomainFixture[]>} fetchFixtures
 * @property {(season:number) => Promise<DomainStanding[]>} fetchStandings
 * @property {(fixtureId:string) => Promise<RawProb|null>} fetchPredictions
 * @property {() => Promise<DomainFixture[]>} fetchLive
 * @property {(season:number) => Promise<DomainTeam[]>} fetchTeams
 */
export {} // types-only module
```

- [ ] **Step 4: Create the test double `api/src/providers/recorded-provider.js`** (maps recorded raw JSON through the same mapping layer Task 3 builds, so the double and the real provider return identical domain shapes):

```js
import { mapFixture, mapStanding, mapPrediction, mapTeam } from './mapping.js'

/** Build a FootballProvider from already-parsed raw API-Football JSON objects. */
export function createRecordedProvider({ fixtures, live, standings, predictions, teams } = {}) {
  return {
    async fetchFixtures() { return (fixtures?.response ?? []).map(mapFixture) },
    async fetchLive() { return (live?.response ?? []).map(mapFixture) },
    async fetchStandings() { return (standings?.response?.[0]?.league?.standings ?? []).flat().map(mapStanding) },
    async fetchPredictions() { return mapPrediction(predictions) },
    async fetchTeams() { return (teams?.response ?? []).map(mapTeam) },
  }
}
```

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "chore(worker): node-cron dep, provider interface, recorded API-Football JSON"
```

---

## Task 2: Mapping layer (pure) — raw v3 JSON → domain

**Files:**
- Create: `api/src/providers/mapping.js`
- Test: `api/test/mapping.test.js`

- [ ] **Step 1: Write the failing unit test `api/test/mapping.test.js`** (no DB — pure functions; loads the recorded JSON):

```js
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapStatus, parseRound, mapFixture, mapStanding, mapPrediction, mapTeam } from '../src/providers/mapping.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))

test('mapStatus maps API short codes to our status', () => {
  expect(mapStatus('NS')).toBe('upcoming')
  expect(mapStatus('FT')).toBe('final')
  expect(mapStatus('AET')).toBe('final')
  expect(mapStatus('2H')).toBe('live')
  expect(mapStatus('HT')).toBe('live')
  expect(mapStatus('PST')).toBe('upcoming')
})

test('parseRound extracts group letter, matchday, and stage', () => {
  expect(parseRound('Group L - 1')).toEqual({ group: 'L', matchday: 1, stage: 'group' })
  expect(parseRound('Group A - 3')).toEqual({ group: 'A', matchday: 3, stage: 'group' })
  expect(parseRound('Round of 16')).toEqual({ group: '', matchday: 0, stage: 'knockout' })
})

test('mapFixture turns a raw fixture into a DomainFixture', () => {
  const [fin, ups] = load('fixtures').response.map(mapFixture)
  expect(fin).toMatchObject({
    id: '9001', group: 'L', matchday: 1, stage: 'group',
    homeProviderId: 3001, awayProviderId: 3002, status: 'final',
    score1: 2, score2: 1, venue: 'Estadio Akron', city: 'Guadalajara',
  })
  expect(fin.kickoffUtc instanceof Date).toBe(true)
  expect(ups).toMatchObject({ id: '9002', status: 'upcoming', score1: null, score2: null, minute: null })
})

test('mapStanding maps a raw row (lose→loss, goals.for/against→gf/ga)', () => {
  const rows = load('standings').response[0].league.standings.flat().map(mapStanding)
  expect(rows[0]).toEqual({ providerTeamId: 3001, played: 1, win: 1, draw: 0, loss: 0, gf: 2, ga: 1, pts: 3 })
})

test('mapPrediction turns percent strings into integers, or null', () => {
  expect(mapPrediction(load('predictions'))).toEqual({ a: 55, d: 25, b: 20 })
  expect(mapPrediction({ response: [] })).toBeNull()
  expect(mapPrediction(null)).toBeNull()
})

test('mapTeam extracts provider id, name, code, country', () => {
  expect(load('teams').response.map(mapTeam)[0]).toEqual({ providerTeamId: 3001, name: 'Croatia', code: 'CRO', country: 'Croatia' })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w api -- mapping`
Expected: FAIL — module `../src/providers/mapping.js` not found.

- [ ] **Step 3: Implement `api/src/providers/mapping.js`**

```js
const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'])
const FINAL = new Set(['FT', 'AET', 'PEN'])

/** API-Football fixture status short code → our status. Unknown/postponed → 'upcoming'. */
export function mapStatus(short) {
  if (FINAL.has(short)) return 'final'
  if (LIVE.has(short)) return 'live'
  return 'upcoming'
}

/** "Group L - 1" → {group:'L', matchday:1, stage:'group'}; non-group → {group:'',matchday:0,stage:'knockout'}. */
export function parseRound(round) {
  const m = /Group\s+([A-L])\s*-\s*(\d+)/i.exec(round ?? '')
  if (m) return { group: m[1].toUpperCase(), matchday: Number(m[2]), stage: 'group' }
  return { group: '', matchday: 0, stage: 'knockout' }
}

export function mapFixture(raw) {
  const { group, matchday, stage } = parseRound(raw.league?.round)
  const status = mapStatus(raw.fixture?.status?.short)
  return {
    id: String(raw.fixture.id),
    group, matchday, stage,
    homeProviderId: raw.teams.home.id,
    awayProviderId: raw.teams.away.id,
    kickoffUtc: new Date(raw.fixture.date),
    venue: raw.fixture.venue?.name ?? '',
    city: raw.fixture.venue?.city ?? '',
    status,
    score1: raw.goals?.home ?? null,
    score2: raw.goals?.away ?? null,
    minute: status === 'live' ? (raw.fixture?.status?.elapsed ?? null) : null,
  }
}

export function mapStanding(raw) {
  return {
    providerTeamId: raw.team.id,
    played: raw.all.played, win: raw.all.win, draw: raw.all.draw, loss: raw.all.lose,
    gf: raw.all.goals.for, ga: raw.all.goals.against, pts: raw.points,
  }
}

const pct = (s) => (s == null ? null : Number(String(s).replace('%', '').trim()))

/** /predictions response → {a,d,b} integer percents (home,draw,away), or null if absent. */
export function mapPrediction(rawResponse) {
  const p = rawResponse?.response?.[0]?.predictions?.percent
  if (!p) return null
  const a = pct(p.home), d = pct(p.draw), b = pct(p.away)
  if (a == null || d == null || b == null) return null
  return { a, d, b }
}

export function mapTeam(raw) {
  return { providerTeamId: raw.team.id, name: raw.team.name, code: raw.team.code ?? null, country: raw.team.country ?? null }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w api -- mapping`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(worker): pure mapping layer for API-Football v3 → domain"
```

---

## Task 3: `ApiFootballProvider` — HTTP client with retry/backoff

**Files:**
- Create: `api/src/providers/api-football-provider.js`
- Test: `api/test/api-football-provider.test.js`

- [ ] **Step 1: Write the failing test `api/test/api-football-provider.test.js`** (inject a fake `fetch`; assert headers, URL params, retry, and that responses are mapped to domain):

```js
import { expect, test, vi } from 'vitest'
import { createApiFootballProvider } from '../src/providers/api-football-provider.js'

function fakeFetch(routes) {
  return vi.fn(async (url) => {
    const u = new URL(url)
    const key = u.pathname + (u.search || '')
    const match = Object.keys(routes).find((r) => key.startsWith(r))
    if (!match) return { ok: false, status: 404, json: async () => ({ response: [] }) }
    const r = routes[match]
    return { ok: true, status: 200, json: async () => r }
  })
}

test('sends the api key header and league/season params', async () => {
  const fetch = fakeFetch({ '/fixtures': { response: [] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  await p.fetchFixtures(2026)
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.searchParams.get('league')).toBe('1')
  expect(calledUrl.searchParams.get('season')).toBe('2026')
  expect(fetch.mock.calls[0][1].headers['x-apisports-key']).toBe('K')
})

test('fetchFixtures maps raw response to domain fixtures', async () => {
  const fetch = fakeFetch({ '/fixtures': {
    response: [{ fixture: { id: 1, date: '2026-06-13T03:30:00+00:00', status: { short: 'NS', elapsed: null }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Group A - 1' }, teams: { home: { id: 10 }, away: { id: 11 } }, goals: { home: null, away: null } }] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const [f] = await p.fetchFixtures(2026)
  expect(f).toMatchObject({ id: '1', group: 'A', homeProviderId: 10, awayProviderId: 11, status: 'upcoming' })
})

test('retries on a 500 then succeeds', async () => {
  let n = 0
  const fetch = vi.fn(async () => (++n < 2
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ response: [] }) }))
  const p = createApiFootballProvider({ apiKey: 'K', fetch, retries: 3, retryDelayMs: 0 })
  await p.fetchStandings(2026)
  expect(n).toBe(2)
})

test('throws after exhausting retries', async () => {
  const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
  const p = createApiFootballProvider({ apiKey: 'K', fetch, retries: 2, retryDelayMs: 0 })
  await expect(p.fetchLive()).rejects.toThrow(/api-football/i)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w api -- api-football-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api/src/providers/api-football-provider.js`**

```js
import { mapFixture, mapStanding, mapPrediction, mapTeam } from './mapping.js'

const BASE = 'https://v3.football.api-sports.io'
const LEAGUE = 1

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {{apiKey:string, fetch?:typeof fetch, retries?:number, retryDelayMs?:number, base?:string}} opts
 * @returns {import('./football-provider.js').FootballProvider}
 */
export function createApiFootballProvider({ apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500, base = BASE }) {
  async function get(path, params = {}) {
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    let lastErr
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url.toString(), { headers: { 'x-apisports-key': apiKey } })
        if (res.ok) return await res.json()
        lastErr = new Error(`api-football ${path} → HTTP ${res.status}`)
        if (res.status < 500 && res.status !== 429) break // client errors don't retry (except rate-limit)
      } catch (e) { lastErr = e }
      if (attempt < retries - 1) await sleep(retryDelayMs * 2 ** attempt)
    }
    throw lastErr ?? new Error(`api-football ${path} failed`)
  }

  return {
    async fetchFixtures(season) {
      const j = await get('/fixtures', { league: LEAGUE, season })
      return (j.response ?? []).map(mapFixture)
    },
    async fetchLive() {
      const j = await get('/fixtures', { live: 'all' })
      return (j.response ?? []).filter((r) => r.league?.id === LEAGUE).map(mapFixture)
    },
    async fetchStandings(season) {
      const j = await get('/standings', { league: LEAGUE, season })
      return (j.response?.[0]?.league?.standings ?? []).flat().map(mapStanding)
    },
    async fetchPredictions(fixtureId) {
      const j = await get('/predictions', { fixture: fixtureId })
      return mapPrediction(j)
    },
    async fetchTeams(season) {
      const j = await get('/teams', { league: LEAGUE, season })
      return (j.response ?? []).map(mapTeam)
    },
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w api -- api-football-provider`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(worker): ApiFootballProvider with key header and retry/backoff"
```

---

## Task 4: Crosswalk — resolver (assert) + offline matcher + sync CLI

**Files:**
- Create: `api/src/worker/crosswalk.js`, `api/src/worker/crosswalk-sync.js`
- Test: `api/test/crosswalk.test.js`

- [ ] **Step 1: Write the failing test `api/test/crosswalk.test.js`** (integration — uses the seeded DB, which has `team_crosswalk` rows with NULL provider ids):

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk } from '../src/db/schema.js'
import { resolveCrosswalk, assertResolved } from '../src/worker/crosswalk.js'
import { matchTeams } from '../src/worker/crosswalk-sync.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

// reset provider ids before each test so we don't depend on order
beforeEach(async () => { await db.update(teamCrosswalk).set({ providerTeamId: null }) })

test('matchTeams maps provider teams to our codes by name/country', () => {
  const ours = [{ code: 'hr', name: 'Croatia' }, { code: 'be', name: 'Belgium' }, { code: 'gh', name: 'Ghana' }]
  const provider = [
    { providerTeamId: 3001, name: 'Croatia', country: 'Croatia' },
    { providerTeamId: 3002, name: 'Belgium', country: 'Belgium' },
    { providerTeamId: 4040, name: 'Nowhere', country: 'Nowhere' },
  ]
  const { matched, unmatchedProvider, unmatchedOurs } = matchTeams(ours, provider)
  expect(matched).toEqual(expect.arrayContaining([
    { teamCode: 'hr', providerTeamId: 3001 }, { teamCode: 'be', providerTeamId: 3002 },
  ]))
  expect(unmatchedOurs.map((t) => t.code)).toContain('gh')
  expect(unmatchedProvider.map((t) => t.providerTeamId)).toContain(4040)
})

test('resolveCrosswalk returns a providerId→code map for filled rows only', async () => {
  await db.update(teamCrosswalk).set({ providerTeamId: 3001 }).where(eq(teamCrosswalk.teamCode, 'hr'))
  const map = await resolveCrosswalk(db)
  expect(map.get(3001)).toBe('hr')
  expect(map.size).toBe(1)
})

test('assertResolved throws loudly listing unresolved provider ids', async () => {
  await db.update(teamCrosswalk).set({ providerTeamId: 3001 }).where(eq(teamCrosswalk.teamCode, 'hr'))
  const map = await resolveCrosswalk(db)
  expect(() => assertResolved(map, [3001, 3002])).toThrow(/3002/)
  expect(() => assertResolved(map, [3001])).not.toThrow()
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w api -- crosswalk`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `api/src/worker/crosswalk.js`**

```js
import { teamCrosswalk } from '../db/schema.js'

/** @returns {Promise<Map<number,string>>} providerTeamId → team.code, only for filled rows. */
export async function resolveCrosswalk(db) {
  const rows = await db.select().from(teamCrosswalk)
  const map = new Map()
  for (const r of rows) if (r.providerTeamId != null) map.set(r.providerTeamId, r.teamCode)
  return map
}

/** Throw if any provider id we need isn't in the crosswalk — fail loudly, never silently drop a match. */
export function assertResolved(map, providerIds) {
  const missing = [...new Set(providerIds)].filter((id) => !map.has(id))
  if (missing.length) {
    throw new Error(`team_crosswalk missing provider team ids: ${missing.join(', ')}. Run \`npm run crosswalk:sync -w api\` and fill any unmatched.`)
  }
}
```

- [ ] **Step 4: Implement `api/src/worker/crosswalk-sync.js`** (pure `matchTeams` + a CLI that writes resolved ids and prints a report):

```js
import { eq } from 'drizzle-orm'
import { team, teamCrosswalk } from '../db/schema.js'
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'

const norm = (s) => (s ?? '').toLowerCase().trim()

/**
 * Match our teams to provider teams by exact name, then country.
 * @returns {{matched:{teamCode:string,providerTeamId:number}[], unmatchedProvider:any[], unmatchedOurs:any[]}}
 */
export function matchTeams(ourTeams, providerTeams) {
  const byName = new Map(providerTeams.map((p) => [norm(p.name), p]))
  const byCountry = new Map(providerTeams.map((p) => [norm(p.country), p]))
  const used = new Set()
  const matched = []
  const unmatchedOurs = []
  for (const t of ourTeams) {
    const hit = byName.get(norm(t.name)) ?? byCountry.get(norm(t.name))
    if (hit && !used.has(hit.providerTeamId)) {
      matched.push({ teamCode: t.code, providerTeamId: hit.providerTeamId })
      used.add(hit.providerTeamId)
    } else {
      unmatchedOurs.push(t)
    }
  }
  const unmatchedProvider = providerTeams.filter((p) => !used.has(p.providerTeamId))
  return { matched, unmatchedProvider, unmatchedOurs }
}

export async function syncCrosswalk(db, provider, { season }) {
  const [ourTeams, providerTeams] = await Promise.all([db.select().from(team), provider.fetchTeams(season)])
  const { matched, unmatchedProvider, unmatchedOurs } = matchTeams(ourTeams, providerTeams)
  for (const m of matched) {
    await db.update(teamCrosswalk).set({ providerTeamId: m.providerTeamId }).where(eq(teamCrosswalk.teamCode, m.teamCode))
  }
  return { matchedCount: matched.length, unmatchedOurs, unmatchedProvider }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const season = Number(process.env.WC_SEASON ?? 2026)
  const pool = createPool()
  const db = createDb(pool)
  const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
  const report = await syncCrosswalk(db, provider, { season })
  await pool.end()
  console.log(`crosswalk: matched ${report.matchedCount}/48`)
  if (report.unmatchedOurs.length) console.warn('UNMATCHED (ours, fill manually):', report.unmatchedOurs.map((t) => `${t.code}:${t.name}`).join(', '))
  if (report.unmatchedProvider.length) console.warn('UNMATCHED (provider):', report.unmatchedProvider.map((t) => `${t.providerTeamId}:${t.name}`).join(', '))
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm run test -w api -- crosswalk`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(worker): crosswalk resolver (loud assert) + offline matcher + sync CLI"
```

---

## Task 5: Flags — derby / double-owner (pure)

**Files:**
- Create: `api/src/worker/flags.js`
- Test: `api/test/flags.test.js`

> Mirrors the Phase 1 `data.js` rule: a fixture is a **derby** if both sides have ≥1 owner; **double-owner** if at least one person owns *both* sides.

- [ ] **Step 1: Write the failing test `api/test/flags.test.js`**

```js
import { expect, test } from 'vitest'
import { computeFlags } from '../src/worker/flags.js'

const ownership = [
  { personId: 'p1', teamCode: 'hr' }, { personId: 'p1', teamCode: 'be' }, // p1 owns both hr & be
  { personId: 'p2', teamCode: 'gh' },
]

test('derby when both sides owned; doubleOwner when one person owns both', () => {
  const flags = computeFlags(
    [{ id: '1', t1Code: 'hr', t2Code: 'be' }, { id: '2', t1Code: 'hr', t2Code: 'gh' }, { id: '3', t1Code: 'fr', t2Code: 'gh' }],
    ownership,
  )
  expect(flags.get('1')).toEqual({ derby: true, doubleOwner: true })   // hr&be both owned, p1 owns both
  expect(flags.get('2')).toEqual({ derby: true, doubleOwner: false })  // hr & gh owned by different people
  expect(flags.get('3')).toEqual({ derby: false, doubleOwner: false }) // fr unowned
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w api -- flags`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api/src/worker/flags.js`**

```js
/**
 * @param {{id:string,t1Code:string,t2Code:string}[]} fixtures
 * @param {{personId:string,teamCode:string}[]} ownershipRows
 * @returns {Map<string,{derby:boolean,doubleOwner:boolean}>}
 */
export function computeFlags(fixtures, ownershipRows) {
  const ownersByTeam = new Map()
  for (const o of ownershipRows) {
    if (!ownersByTeam.has(o.teamCode)) ownersByTeam.set(o.teamCode, new Set())
    ownersByTeam.get(o.teamCode).add(o.personId)
  }
  const out = new Map()
  for (const f of fixtures) {
    const o1 = ownersByTeam.get(f.t1Code) ?? new Set()
    const o2 = ownersByTeam.get(f.t2Code) ?? new Set()
    const derby = o1.size > 0 && o2.size > 0
    const doubleOwner = [...o1].some((p) => o2.has(p))
    out.set(f.id, { derby, doubleOwner })
  }
  return out
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w api -- flags`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(worker): pure derby/double-owner flag computation"
```

---

## Task 6: Baseline sync — upsert + prune + sync_log + last-good on failure

**Files:**
- Create: `api/src/worker/baseline-sync.js`, `api/src/worker/run-baseline.js`
- Test: `api/test/baseline-sync.test.js`

- [ ] **Step 1: Write the failing test `api/test/baseline-sync.test.js`** (integration; uses `RecordedProvider` + seeded crosswalk):

```js
import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk, fixture, standing, syncLog } from '../src/db/schema.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()

const provider = createRecordedProvider({
  fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams'),
})

beforeAll(async () => {
  // wire crosswalk: hr→3001, be→3002, gh→3003 (matches recorded JSON)
  await db.update(teamCrosswalk).set({ providerTeamId: 3001 }).where(eq(teamCrosswalk.teamCode, 'hr'))
  await db.update(teamCrosswalk).set({ providerTeamId: 3002 }).where(eq(teamCrosswalk.teamCode, 'be'))
  await db.update(teamCrosswalk).set({ providerTeamId: 3003 }).where(eq(teamCrosswalk.teamCode, 'gh'))
})
afterAll(async () => { await pool.end() })

test('baseline sync upserts provider fixtures, prunes seed fixtures, logs ok', async () => {
  await syncBaseline(db, provider, { season: 2026 })
  const fx = await db.select().from(fixture)
  const ids = fx.map((f) => f.id).sort()
  expect(ids).toEqual(['9001', '9002'])            // seeded m0..m71 pruned; provider fixtures present
  const f1 = fx.find((f) => f.id === '9001')
  expect(f1).toMatchObject({ t1Code: 'hr', t2Code: 'be', status: 'final', score1: 2, score2: 1, group: 'L', matchday: 1 })
  expect(f1.probA).toBe(55)                        // predictions applied
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('ok')
})

test('is idempotent — second run changes nothing structural', async () => {
  await syncBaseline(db, provider, { season: 2026 })
  expect((await db.select().from(fixture)).length).toBe(2)
  const cro = (await db.select().from(standing).where(eq(standing.teamCode, 'hr')))[0]
  expect(cro).toMatchObject({ played: 1, win: 1, pts: 3, gf: 2, ga: 1 })
})

test('a provider failure leaves last-good data and logs an error row', async () => {
  const boom = { ...provider, async fetchFixtures() { throw new Error('upstream 503') } }
  await expect(syncBaseline(db, boom, { season: 2026 })).rejects.toThrow(/503/)
  expect((await db.select().from(fixture)).length).toBe(2) // unchanged
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'baseline'))
  expect(logs.at(-1).status).toBe('error')
  expect(logs.at(-1).error).toMatch(/503/)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w api -- baseline-sync`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api/src/worker/baseline-sync.js`**

```js
import { notInArray } from 'drizzle-orm'
import { fixture, standing, ownership, syncLog } from '../db/schema.js'
import { resolveCrosswalk, assertResolved } from './crosswalk.js'
import { computeFlags } from './flags.js'

/**
 * Fetch fixtures + standings + predictions, map provider ids via crosswalk (loud assert),
 * compute flags, upsert idempotently, prune fixtures no longer present, write a sync_log row.
 * On any failure: write an error sync_log row and rethrow — last-good data is untouched.
 */
export async function syncBaseline(db, provider, { season }) {
  try {
    const [rawFixtures, standings, crosswalk, ownershipRows] = await Promise.all([
      provider.fetchFixtures(season),
      provider.fetchStandings(season),
      resolveCrosswalk(db),
      db.select().from(ownership),
    ])

    const neededIds = rawFixtures.flatMap((f) => [f.homeProviderId, f.awayProviderId])
      .concat(standings.map((s) => s.providerTeamId))
    assertResolved(crosswalk, neededIds)

    // resolve provider ids → our codes
    const fixtures = rawFixtures.map((f) => ({
      ...f, t1Code: crosswalk.get(f.homeProviderId), t2Code: crosswalk.get(f.awayProviderId),
    }))
    const flags = computeFlags(fixtures, ownershipRows)

    // predictions: best-effort per fixture (missing → leave prob null, never throw)
    const probById = new Map()
    for (const f of fixtures) {
      try { const p = await provider.fetchPredictions(f.id); if (p) probById.set(f.id, p) } catch { /* best-effort */ }
    }

    for (const f of fixtures) {
      const fl = flags.get(f.id)
      const prob = probById.get(f.id)
      await db.insert(fixture).values({
        id: f.id, group: f.group, matchday: f.matchday, t1Code: f.t1Code, t2Code: f.t2Code,
        kickoffUtc: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
        score1: f.score1, score2: f.score2, minute: f.minute,
        probA: prob?.a ?? null, probD: prob?.d ?? null, probB: prob?.b ?? null,
        stage: f.stage || 'group', derby: fl.derby, doubleOwner: fl.doubleOwner, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: fixture.id,
        set: {
          group: f.group, matchday: f.matchday, t1Code: f.t1Code, t2Code: f.t2Code,
          kickoffUtc: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
          score1: f.score1, score2: f.score2, minute: f.minute,
          // predictions are best-effort: only overwrite when we got fresh numbers
          ...(prob ? { probA: prob.a, probD: prob.d, probB: prob.b } : {}),
          stage: f.stage || 'group', derby: fl.derby, doubleOwner: fl.doubleOwner, updatedAt: new Date(),
        },
      })
    }

    // prune fixtures not in the latest provider set (safe pre-Phase-4; no watch/support rows yet).
    // Guard the whole call: an empty fetch is suspicious — prune nothing rather than wipe the table.
    const keep = fixtures.map((f) => f.id)
    if (keep.length) await db.delete(fixture).where(notInArray(fixture.id, keep))

    for (const s of standings) {
      const teamCode = crosswalk.get(s.providerTeamId)
      await db.insert(standing).values({
        teamCode, played: s.played, win: s.win, draw: s.draw, loss: s.loss, gf: s.gf, ga: s.ga, pts: s.pts, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: standing.teamCode,
        set: { played: s.played, win: s.win, draw: s.draw, loss: s.loss, gf: s.gf, ga: s.ga, pts: s.pts, updatedAt: new Date() },
      })
    }

    await db.insert(syncLog).values({
      source: 'api-football', kind: 'baseline', status: 'ok',
      counts: { fixtures: fixtures.length, standings: standings.length, predictions: probById.size },
    })
    return { fixtures: fixtures.length, standings: standings.length }
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
```

> **Note for the implementer:** `run-baseline.js` (next step) owns DB/pool construction — `baseline-sync.js` deliberately imports none of that, only Drizzle ops. Keep imports clean (no unused symbols).

- [ ] **Step 4: Implement the CLI `api/src/worker/run-baseline.js`**

```js
import { createPool, createDb } from '../db/client.js'
import { createApiFootballProvider } from '../providers/api-football-provider.js'
import { syncBaseline } from './baseline-sync.js'

const season = Number(process.env.WC_SEASON ?? 2026)
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })
try {
  const r = await syncBaseline(db, provider, { season })
  console.log(`baseline sync ok: ${r.fixtures} fixtures, ${r.standings} standings`)
} catch (e) {
  console.error('baseline sync FAILED (last-good data left intact):', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm run test -w api -- baseline-sync`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(worker): idempotent baseline sync (upsert+prune+sync_log, last-good on failure)"
```

---

## Task 7: Live poller + kickoff-window scheduling logic

**Files:**
- Create: `api/src/worker/live-poller.js`
- Test: `api/test/live-poller.test.js`

- [ ] **Step 1: Write the failing test `api/test/live-poller.test.js`** (window logic is pure; the DB update is integration — depends on Task 6 having seeded fixtures `9001/9002`):

```js
import { expect, test, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { teamCrosswalk, fixture } from '../src/db/schema.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'
import { pollLive, isLiveWindow } from '../src/worker/live-poller.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const { pool, db } = openTestDb()

beforeAll(async () => {
  for (const [code, id] of [['hr', 3001], ['be', 3002], ['gh', 3003]]) {
    await db.update(teamCrosswalk).set({ providerTeamId: id }).where(eq(teamCrosswalk.teamCode, code))
  }
  await syncBaseline(db, createRecordedProvider({ fixtures: load('fixtures'), standings: load('standings'), predictions: load('predictions'), teams: load('teams') }), { season: 2026 })
})
afterAll(async () => { await pool.end() })

test('isLiveWindow is true within ±N minutes of any kickoff', () => {
  const kickoffs = [new Date('2026-06-16T09:00:00Z')]
  expect(isLiveWindow(new Date('2026-06-16T09:30:00Z'), kickoffs, 150)).toBe(true)   // 30m after KO
  expect(isLiveWindow(new Date('2026-06-16T08:55:00Z'), kickoffs, 150)).toBe(true)   // 5m before KO
  expect(isLiveWindow(new Date('2026-06-16T13:00:00Z'), kickoffs, 150)).toBe(false)  // 4h after → idle
})

test('pollLive updates score/minute/status for in-play fixtures only', async () => {
  const liveProvider = createRecordedProvider({ live: load('fixtures-live') }) // fixture 9002 now 2H 63\' 1-0
  const n = await pollLive(db, liveProvider)
  expect(n).toBe(1)
  const f = (await db.select().from(fixture).where(eq(fixture.id, '9002')))[0]
  expect(f).toMatchObject({ status: 'live', minute: 63, score1: 1, score2: 0 })
  const other = (await db.select().from(fixture).where(eq(fixture.id, '9001')))[0]
  expect(other.status).toBe('final') // untouched
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w api -- live-poller`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api/src/worker/live-poller.js`**

```js
import { eq } from 'drizzle-orm'
import { fixture, syncLog } from '../db/schema.js'

/** True if `now` is within `windowMin` minutes after (or 10 min before) any kickoff. */
export function isLiveWindow(now, kickoffs, windowMin = 150) {
  const t = now.getTime()
  return kickoffs.some((k) => {
    const ko = k.getTime()
    return t >= ko - 10 * 60_000 && t <= ko + windowMin * 60_000
  })
}

/**
 * Poll all in-play fixtures and update score/minute/status for the ones we know.
 * @returns {Promise<number>} count of fixtures updated
 */
export async function pollLive(db, provider) {
  try {
    const live = await provider.fetchLive()
    let updated = 0
    for (const f of live) {
      const res = await db.update(fixture)
        .set({ status: f.status, score1: f.score1, score2: f.score2, minute: f.minute, updatedAt: new Date() })
        .where(eq(fixture.id, f.id))
        .returning({ id: fixture.id })
      updated += res.length
    }
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'ok', counts: { live: live.length, updated } })
    return updated
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w api -- live-poller`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(worker): windowed live poller updating score/minute/status"
```

---

## Task 8: Freshness — stale flag + `GET /api/sync-status`

**Files:**
- Create: `api/src/routes/sync-status.js`
- Modify: `api/src/app.js` (register the route)
- Test: `api/test/sync-status.test.js`

- [ ] **Step 1: Write the failing test `api/test/sync-status.test.js`**

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { syncLog } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })
beforeEach(async () => { await db.delete(syncLog) })

test('stale=true when no baseline sync has ever run', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/sync-status' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ stale: true, lastBaselineAt: null })
})

test('stale=false right after a successful baseline sync', async () => {
  await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'ok' })
  expect((await app.inject({ method: 'GET', url: '/api/sync-status' })).json().stale).toBe(false)
})

test('stale=true when newest OK baseline is older than 18h', async () => {
  const old = new Date(Date.now() - 19 * 3600_000)
  await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'ok', ranAt: old })
  expect((await app.inject({ method: 'GET', url: '/api/sync-status' })).json().stale).toBe(true)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w api -- sync-status`
Expected: FAIL — route not registered (404 → `stale` undefined).

- [ ] **Step 3: Implement `api/src/routes/sync-status.js`**

```js
import { and, eq, desc } from 'drizzle-orm'
import { syncLog } from '../db/schema.js'

const STALE_MS = 18 * 3600_000

export async function syncStatusRoutes(app) {
  app.get('/api/sync-status', async () => {
    const newest = async (kind) => {
      const rows = await app.db.select().from(syncLog)
        .where(and(eq(syncLog.kind, kind), eq(syncLog.status, 'ok')))
        .orderBy(desc(syncLog.ranAt)).limit(1)
      return rows[0]?.ranAt ?? null
    }
    const [lastBaselineAt, lastLiveAt] = await Promise.all([newest('baseline'), newest('live')])
    const stale = !lastBaselineAt || (Date.now() - new Date(lastBaselineAt).getTime() > STALE_MS)
    return { stale, lastBaselineAt, lastLiveAt }
  })
}
```

- [ ] **Step 4: Register in `api/src/app.js`** — add `import { syncStatusRoutes } from './routes/sync-status.js'` and `app.register(syncStatusRoutes)` before `return app`.

- [ ] **Step 5: Run to confirm pass**

Run: `npm run test -w api -- sync-status`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(api): GET /api/sync-status with 18h stale flag"
```

---

## Task 9: Worker entrypoint (node-cron), env wiring, runbook docs

**Files:**
- Create: `api/src/worker.js`
- Modify: `.env.example` (add `API_FOOTBALL_KEY`, `WC_SEASON`)
- Modify: `CLAUDE.md` (Phase 2 commands), `web/README.md` or a new `docs/runbook-worker.md` (crosswalk seeding runbook)

- [ ] **Step 1: Implement `api/src/worker.js`** (long-running: a few baseline syncs/day via cron; a 60s live tick that only calls the API inside kickoff windows):

```js
import cron from 'node-cron'
import { createPool, createDb } from './db/client.js'
import { createApiFootballProvider } from './providers/api-football-provider.js'
import { syncBaseline } from './worker/baseline-sync.js'
import { pollLive, isLiveWindow } from './worker/live-poller.js'
import { fixture } from './db/schema.js'

const season = Number(process.env.WC_SEASON ?? 2026)
const pool = createPool()
const db = createDb(pool)
const provider = createApiFootballProvider({ apiKey: process.env.API_FOOTBALL_KEY })

async function baseline(reason) {
  try { const r = await syncBaseline(db, provider, { season }); console.log(`[baseline:${reason}] ${r.fixtures} fixtures`) }
  catch (e) { console.error(`[baseline:${reason}] failed (last-good intact):`, e.message) }
}

// Baseline a few times a day (00:10, 06:10, 12:10, 18:10 UTC) + once at boot.
cron.schedule('10 0,6,12,18 * * *', () => baseline('cron'))
await baseline('boot')

// Live tick every 60s, but only hit the API inside a kickoff window.
setInterval(async () => {
  try {
    const kickoffs = (await db.select({ ko: fixture.kickoffUtc }).from(fixture)).map((r) => new Date(r.ko))
    if (!isLiveWindow(new Date(), kickoffs)) return
    const n = await pollLive(db, provider)
    if (n) console.log(`[live] updated ${n}`)
  } catch (e) { console.error('[live] failed:', e.message) }
}, 60_000)

console.log(`worker up — season ${season}`)
```

> **Note:** SSE emission on score changes (so clients see goals live) is **Phase 4** (social layer + `/api/stream`). This phase persists live updates to Postgres; the read endpoints already serve them. Don't add SSE here.

- [ ] **Step 2: Add env keys to `.env.example`** — append:
```
# Phase 2 — football worker (human provides the real key; never commit it)
API_FOOTBALL_KEY=your-api-football-pro-key
WC_SEASON=2026
```

- [ ] **Step 3: Create `docs/runbook-worker.md`** — the one online step (crosswalk seeding) + how to run the worker:
```markdown
# Worker runbook

1. Put the real key in `.env`: `API_FOOTBALL_KEY=...` (Pro tier; league 1 / season 2026).
2. Seed the team crosswalk (provider team ids) — requires the key:
   `npm run crosswalk:sync -w api`
   Review the printed report; for any UNMATCHED team, find its id in the API-Football
   dashboard and set it: `update team_crosswalk set provider_team_id=<id> where team_code='<code>';`
   Re-run until "matched 48/48".
3. One-shot baseline pull: `npm run sync -w api` (replaces seeded fixtures/standings with real data).
4. Run the worker (baseline schedule + windowed live poller): `npm run worker -w api`.
5. Freshness: `GET /api/sync-status` → `{stale:false}` after a successful baseline.
```

- [ ] **Step 4: Update `CLAUDE.md`** — under "Commands", add the three worker scripts (`sync`, `crosswalk:sync`, `worker`) and note `API_FOOTBALL_KEY` is now required for live data.

- [ ] **Step 5: Full suite + commit**

Run: `npm run test -w api`
Expected: all suites green (Phase 1 + mapping, api-football-provider, crosswalk, flags, baseline-sync, live-poller, sync-status).
```bash
git add -A && git commit -m "feat(worker): node-cron entrypoint, env + crosswalk runbook"
```

---

## Done criteria for Phase 2

- `npm run test -w api` fully green, including the new offline worker suites (mapping, provider client, crosswalk, flags, baseline sync idempotency + last-good-on-failure, live poller, stale flag).
- With a real `API_FOOTBALL_KEY`: `npm run crosswalk:sync -w api` reaches 48/48, `npm run sync -w api` replaces seeded fixtures/standings with real World Cup data, `GET /api/sync-status` reports `stale:false`, and `npm run worker -w api` keeps scores ticking inside kickoff windows.
- The site still reads only from Postgres; an API outage logs to `sync_log` and leaves last-good data serving.
- **Next phase (3):** frontend data layer — TanStack Query client returning the `SWEEP` shape from these endpoints; remove static `data.js`; loading/error states + the `stale` banner driven by `GET /api/sync-status`.

---

## Open items to confirm before/while executing

- **Recorded JSON ↔ live shapes:** overwrite each `test/fixtures/apifootball/*.json` with one real captured response once the key exists (v3 envelope is stable; mappers shouldn't change, but `league.round` wording for WC groups must be confirmed — the `parseRound` regex assumes `"Group X - N"`).
- **Crosswalk coverage:** confirm all 48 WC teams exist in API-Football for league 1 / season 2026 (spec §9). Name-match may miss a few (e.g. "South Korea" vs "Korea Republic", "USA" vs "United States") — those land in the UNMATCHED report for manual fill; consider a small alias table if more than a couple miss.
- **Rate limit:** verify Pro's per-minute cap; predictions are one call per fixture on baseline (≤72) — fine within 7,500/day, but space them if a per-minute cap bites.
- **Knockout stage:** `stage='knockout'` rows are mapped but `group=''`/`matchday=0`; the read UI ignores them this phase. Revisit data model for brackets in a later phase (spec §9).
```
