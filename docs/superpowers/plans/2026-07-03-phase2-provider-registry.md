# Phase 2 Provider Registry + NBA Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One provider interface (base adapter + per-sport field maps) with the existing API-Football adapter ported behind it and API-Basketball as the second map; an NBA competition syncs from the feed into competition/competitor/event/ranking and a sweep bound to it works end to end with 2-way results.

**Architecture:** Extract the HTTP client from the football adapter into an API-Sports base; each adapter = base client + sport field map + the six interface methods (`fetchCompetitions/fetchCompetitors/fetchSchedule/fetchResults/fetchStandings/resultToWinnerCode`); soccer-only feed features stay as optional capability methods consumers probe. `syncBaseline` generalizes to take the competition row and returns newly-final event ids; the worker fires the settle+rewards chain on them. NBA is baseline-sync-only (owner decision) — the live tick gates on the `fetchLive` capability.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle 0.36, Postgres (testcontainers), Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-03-phase2-provider-registry-design.md`.
**Refinements vs the design doc (record there when this plan is approved):**
`fetchResults(ids)` drops the unused `comp` param (neither API needs it for id lookups);
NBA competitor `meta` carries `{conference}` only (division dropped — nothing consumes it, YAGNI);
per-sport event detail comes from an adapter method `baseDetail(mappedGame)` rather than an
if/else inside `syncBaseline`.

## Global Constraints

- **Never** push to the `upstream` remote. Push to `origin` after each task.
- **Never** touch the shared `sweep` Postgres database. Before any live migration/seed/CLI against the dev DB: `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'` must print `sweep_platform`.
- **Never** run the inherited `Makefile`/`infra/` deploy targets.
- **Wire contract frozen; web untouched:** the web suite (436 tests) passes **unmodified** — owner decision: api/worker-only proof; NBA renders through the existing soccer-speaking UI as-is.
- Baseline at start: api **310** / web **436**, all green (includes the phase-2 gate: per-competition `seasonAnchor`, `eventInCompetition` scoping, required `refundPrunedParlays` scope). If red before you change anything: STOP and report.
- Strict TDD (failing test first, watch it fail, minimal code, watch it pass). Conventional Commits, one commit per task minimum.
- Docker must be running (api tests use testcontainers). Run api tests **from `api/`**: `npx vitest run test/<file>` (running from repo root loses the testcontainers env and fails with `password authentication failed`). Full suites: `npm run test` (repo root) and `npm test -w web`.
- API-Sports free tier: 100 req/day, NBA seasons 2022–2024 only, no `ids=` batching. Task 14 uses ~4 live calls; everything else runs on recorded fixtures in `api/test/fixtures/apibasketball/` (already committed).
- The one env key `API_FOOTBALL_KEY` works for both sport APIs (verified live) — no new env vars.

---

### Task 1: API-Sports base HTTP client

**Files:**
- Create: `api/src/providers/api-sports-base.js`
- Modify: `api/src/providers/api-football-provider.js` (replace its inline `get` with the client)
- Test: `api/test/api-sports-base.test.js`

**Interfaces:**
- Produces: `createApiSportsClient({ base, apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500 })` → `{ get(path, params) }` — identical retry/backoff semantics to today's football adapter (retry 5xx and 429 with exponential backoff, no retry on other 4xx, throws last error), header `x-apisports-key`, params serialized onto the query string. Also `winnerSideToResult(side, sport)` → `'HOME' | 'AWAY' | 'DRAW' | null`; throws `no-draw sport ${sport} produced a drawn final` when `side === 'draw'` and `sportConfig(sport).hasDraws` is false (sports.js consumer #1).
- Consumes: `sportConfig` from `api/src/sports.js`.

- [ ] **Step 1: Write the failing test**

```js
// api/test/api-sports-base.test.js
import { test, expect } from 'vitest'
import { createApiSportsClient, winnerSideToResult } from '../src/providers/api-sports-base.js'

const okJson = (body) => ({ ok: true, json: async () => body })

test('get() hits base+path with params and the api key header', async () => {
  const calls = []
  const client = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k',
    fetch: async (url, opts) => { calls.push({ url, opts }); return okJson({ response: [1] }) },
  })
  const j = await client.get('/games', { league: 12, season: '2023-2024' })
  expect(j).toEqual({ response: [1] })
  expect(calls[0].url).toBe('https://x.test/games?league=12&season=2023-2024')
  expect(calls[0].opts.headers['x-apisports-key']).toBe('k')
})

test('get() retries 500 then succeeds; does not retry 404', async () => {
  let n = 0
  const flaky = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k', retryDelayMs: 1,
    fetch: async () => (++n === 1 ? { ok: false, status: 500 } : okJson({ ok: 1 })),
  })
  expect(await flaky.get('/a')).toEqual({ ok: 1 })
  expect(n).toBe(2)

  let m = 0
  const notFound = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k', retryDelayMs: 1,
    fetch: async () => { m++; return { ok: false, status: 404 } },
  })
  await expect(notFound.get('/a')).rejects.toThrow(/HTTP 404/)
  expect(m).toBe(1)
})

test('winnerSideToResult maps sides and guards no-draw sports', () => {
  expect(winnerSideToResult('home', 'football')).toBe('HOME')
  expect(winnerSideToResult('away', 'basketball')).toBe('AWAY')
  expect(winnerSideToResult('draw', 'football')).toBe('DRAW')
  expect(winnerSideToResult(null, 'football')).toBeNull()
  expect(() => winnerSideToResult('draw', 'basketball')).toThrow(/no-draw/)
})
```

- [ ] **Step 2: Run it** — `cd api && npx vitest run test/api-sports-base.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/providers/api-sports-base.js
import { sportConfig } from '../sports.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Shared HTTP client for the API-Sports family (football/basketball/... are shape-identical). */
export function createApiSportsClient({ base, apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500 }) {
  async function get(path, params = {}) {
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    let lastErr
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url.toString(), { headers: { 'x-apisports-key': apiKey } })
        if (res.ok) return await res.json()
        lastErr = new Error(`api-sports ${path} → HTTP ${res.status}`)
        if (res.status < 500 && res.status !== 429) break // client errors don't retry (except rate-limit)
      } catch (e) { lastErr = e }
      if (attempt < retries - 1) await sleep(retryDelayMs * 2 ** attempt)
    }
    throw lastErr ?? new Error(`api-sports ${path} failed`)
  }
  return { get }
}

/** Mapped winnerSide → settlement result, guarding the 'DRAW' sentinel per sport. */
export function winnerSideToResult(side, sport) {
  if (side == null) return null
  if (side === 'draw' && !sportConfig(sport).hasDraws) {
    throw new Error(`no-draw sport ${sport} produced a drawn final`)
  }
  return side === 'home' ? 'HOME' : side === 'away' ? 'AWAY' : 'DRAW'
}
```

- [ ] **Step 4: Re-point the football adapter** — in `api/src/providers/api-football-provider.js`, delete its local `sleep` + `get` and build them from the client (behavior identical; the error message changes from `api-football` to `api-sports` — nothing asserts on it):

```js
import { mapFixture, mapStanding, mapPrediction, mapTeam, mapMarkets, mapSquad } from './mapping.js'
import { createApiSportsClient } from './api-sports-base.js'

const BASE = 'https://v3.football.api-sports.io'
const LEAGUE = 1

export function createApiFootballProvider({ apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500, base = BASE }) {
  const { get } = createApiSportsClient({ base, apiKey, fetch, retries, retryDelayMs })
  return {
    // ... every existing method body unchanged, still calling get(path, params)
  }
}
```

- [ ] **Step 5: Run** — `npx vitest run test/api-sports-base.test.js test/api-football-provider.test.js`, then the full api suite from repo root. Expected: PASS (310 + 3 new).
- [ ] **Step 6: Commit** — `git add api/src/providers/api-sports-base.js api/src/providers/api-football-provider.js api/test/api-sports-base.test.js && git commit -m "feat(providers): shared api-sports http client + winner-side guard" && git push origin main`

---

### Task 2: Basketball mapping — games

**Files:**
- Create: `api/src/providers/basketball-mapping.js`
- Test: `api/test/basketball-mapping.test.js`
- Reads (already committed): `api/test/fixtures/apibasketball/games.json`

**Interfaces:**
- Produces:
  - `mapGameStatus(short)` → `'upcoming' | 'live' | 'final'` (`FT|AOT` → final; `Q1|Q2|Q3|Q4|OT|BT|HT` → live; everything else incl. `NS` → upcoming).
  - `mapGame(raw)` → mapped game with the **football-core field names** (so the baseline spine is shared): `{ id: String, homeProviderId, awayProviderId, kickoffUtc: Date, status, winnerSide: 'home'|'away'|null, score1, score2, stage: 'group'|'knockout', matchday: 0, group: '', venue, city: '', minute: null, phase, detail: { quarters: {home:[q1..q4], away:[q1..q4]}, ot: [h,a]|null, week } }`. `stage` = `'knockout'` when `raw.week` is non-null else `'group'` (regular season; play-in/All-Star ride along as knockout — All-Star is dropped later by the team filter). A **tied final throws** (`basketball game ${id} is final with a tied score`). `phase` = the live status short (`Q3`, `OT`…) when live, else null.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

```js
// api/test/basketball-mapping.test.js
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapGame, mapGameStatus } from '../src/providers/basketball-mapping.js'

const games = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/games.json', import.meta.url))).response
const byId = (id) => games.find((g) => g.id === id)

test('mapGameStatus buckets basketball status shorts', () => {
  expect(mapGameStatus('NS')).toBe('upcoming')
  expect(mapGameStatus('Q3')).toBe('live')
  expect(mapGameStatus('HT')).toBe('live')
  expect(mapGameStatus('OT')).toBe('live')
  expect(mapGameStatus('FT')).toBe('final')
  expect(mapGameStatus('AOT')).toBe('final')
  expect(mapGameStatus('POST')).toBe('upcoming')
})

test('mapGame maps a regular-season final onto the football-core shape', () => {
  const g = mapGame(byId(372186)) // Timberwolves 111–99 Mavericks
  expect(g).toMatchObject({
    id: '372186', homeProviderId: 149, awayProviderId: 138,
    status: 'final', winnerSide: 'home', score1: 111, score2: 99,
    stage: 'group', group: '', matchday: 0, city: '', minute: null, phase: null,
  })
  expect(g.kickoffUtc).toEqual(new Date('2023-10-05T16:00:00+00:00'))
  expect(g.detail.quarters).toEqual({ home: [37, 29, 21, 24], away: [19, 30, 25, 25] })
  expect(g.detail.ot).toBeNull()
  expect(g.detail.week).toBeNull()
})

test('mapGame: overtime final carries ot pair; playoff week → knockout stage', () => {
  const aot = mapGame(byId(372190)) // Pistons 126–130 Suns AOT
  expect(aot.status).toBe('final')
  expect(aot.winnerSide).toBe('away')
  expect(aot.detail.ot).toEqual([
    byId(372190).scores.home.over_time, byId(372190).scores.away.over_time,
  ])
  const po = mapGame(byId(399891)) // Celtics v Mavs, week 'NBA - Final'
  expect(po.stage).toBe('knockout')
  expect(po.detail.week).toBe('NBA - Final')
})

test('mapGame throws on a tied final (corrupt feed for a no-draw sport)', () => {
  const raw = structuredClone(byId(372186))
  raw.scores.away.total = raw.scores.home.total
  expect(() => mapGame(raw)).toThrow(/tied/)
})
```

- [ ] **Step 2: Run it** — `npx vitest run test/basketball-mapping.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/providers/basketball-mapping.js
const LIVE = new Set(['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT'])
const FINAL = new Set(['FT', 'AOT'])

/** API-Basketball game status short → our status. Unknown/postponed → 'upcoming'. */
export function mapGameStatus(short) {
  if (FINAL.has(short)) return 'final'
  if (LIVE.has(short)) return 'live'
  return 'upcoming'
}

const quarters = (s) => [s.quarter_1 ?? null, s.quarter_2 ?? null, s.quarter_3 ?? null, s.quarter_4 ?? null]

/** Raw /games row → football-core mapped shape (shared baseline spine reads these names). */
export function mapGame(raw) {
  const status = mapGameStatus(raw.status?.short)
  const h = raw.scores?.home?.total ?? null
  const a = raw.scores?.away?.total ?? null
  let winnerSide = null
  if (status === 'final') {
    if (h === a) throw new Error(`basketball game ${raw.id} is final with a tied score`)
    winnerSide = h > a ? 'home' : 'away'
  }
  const ot = raw.scores?.home?.over_time
  return {
    id: String(raw.id),
    homeProviderId: raw.teams.home.id,
    awayProviderId: raw.teams.away.id,
    kickoffUtc: new Date(raw.date),
    status, winnerSide, score1: h, score2: a,
    // regular season → 'group' (the inherited default stage); any week label → knockout.
    // Play-in and All-Star ride along as knockout; All-Star dies at the unknown-team filter.
    stage: raw.week == null ? 'group' : 'knockout',
    group: '', matchday: 0,
    venue: raw.venue ?? '', city: '',
    minute: null,
    phase: status === 'live' ? (raw.status?.short ?? null) : null,
    detail: {
      quarters: { home: quarters(raw.scores?.home ?? {}), away: quarters(raw.scores?.away ?? {}) },
      ot: ot == null ? null : [ot, raw.scores?.away?.over_time ?? null],
      week: raw.week ?? null,
    },
  }
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/providers/basketball-mapping.js api/test/basketball-mapping.test.js && git commit -m "feat(providers): basketball game mapping (2-way winners, quarter detail)" && git push origin main`

---

### Task 3: Basketball mapping — teams, standings, league catalog

**Files:**
- Modify: `api/src/providers/basketball-mapping.js`
- Test: `api/test/basketball-mapping.test.js` (extend)
- Reads: `api/test/fixtures/apibasketball/teams.json`, `standings.json`, `leagues.json`

**Interfaces:**
- Produces (appended to `basketball-mapping.js`):
  - `mapBasketTeam(raw)` → `{ providerTeamId, name, code: null, country, logo }` or **null** for the All-Star squads (`East`/`West` — filter here so every consumer inherits it; callers `.filter(Boolean)`).
  - `mapBasketStanding(raw)` → `{ providerTeamId, group, rank, pts: 0, stats: { played, win, loss, pf, pa, pct } }` for **conference rows only** (`group.name` ending `'Conference'`); division rows → **null** (each team appears twice in the feed).
  - `mapLeague(raw)` → `{ providerLeagueId, name, type, logo, seasons: [{ season, start, end }] }`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test** — append to `api/test/basketball-mapping.test.js`:

```js
import { mapBasketTeam, mapBasketStanding, mapLeague } from '../src/providers/basketball-mapping.js'

const teams = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/teams.json', import.meta.url))).response
const standings = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/standings.json', import.meta.url))).response
const leagues = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/leagues.json', import.meta.url))).response

test('mapBasketTeam maps franchises and nulls the All-Star squads', () => {
  const mapped = teams.map(mapBasketTeam)
  const real = mapped.filter(Boolean)
  expect(real).toHaveLength(30) // 32 raw − East − West
  const okc = real.find((t) => t.name === 'Oklahoma City Thunder')
  expect(okc).toMatchObject({ providerTeamId: 152, code: null, country: 'USA' })
  expect(okc.logo).toMatch(/^https:/)
  expect(teams.filter((t) => t.name === 'East' || t.name === 'West').map(mapBasketTeam)).toEqual([null, null])
})

test('mapBasketStanding keeps conference rows only, with rank and W/L stats', () => {
  const rows = standings[0].map(mapBasketStanding).filter(Boolean)
  expect(rows).toHaveLength(30) // 60 raw − 30 division rows
  const top = rows.find((r) => r.providerTeamId === 152) // OKC, #1 West
  expect(top).toMatchObject({ group: 'Western Conference', rank: 1, pts: 0 })
  expect(top.stats).toEqual({ played: 82, win: 57, loss: 25, pf: 9847, pa: 9239, pct: 0.695 })
})

test('mapLeague maps the catalog entry', () => {
  const l = mapLeague(leagues[0])
  expect(l).toMatchObject({ providerLeagueId: 12, name: 'NBA', type: 'League' })
  expect(l.seasons.map((s) => s.season)).toContain('2023-2024')
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (`mapBasketTeam` not exported).

- [ ] **Step 3: Implement** — append to `api/src/providers/basketball-mapping.js`:

```js
// The feed lists the All-Star squads as teams (and their game as a fixture) — not franchises.
const ALL_STAR = new Set(['East', 'West'])

/** Raw /teams row → domain team, or null for All-Star squads (filter at the map). */
export function mapBasketTeam(raw) {
  if (ALL_STAR.has(raw.name)) return null
  return { providerTeamId: raw.id, name: raw.name, code: null, country: raw.country?.name ?? null, logo: raw.logo ?? null }
}

/** Raw /standings row → ranking-shaped domain row (conference rows only; division duplicates → null). */
export function mapBasketStanding(raw) {
  const group = raw.group?.name ?? ''
  if (!group.endsWith('Conference')) return null
  return {
    providerTeamId: raw.team.id,
    group,
    rank: raw.position,
    pts: 0, // NBA tables rank by win%, not points
    stats: {
      played: raw.games.played,
      win: raw.games.win.total, loss: raw.games.lose.total,
      pf: raw.points.for, pa: raw.points.against,
      pct: Number(raw.games.win.percentage),
    },
  }
}

/** Raw /leagues row → catalog entry. */
export function mapLeague(raw) {
  return {
    providerLeagueId: raw.id, name: raw.name, type: raw.type, logo: raw.logo ?? null,
    seasons: (raw.seasons ?? []).map((s) => ({ season: String(s.season), start: s.start, end: s.end })),
  }
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(providers): basketball team/standing/league mapping (All-Star + division filters)" && git push origin main`

---

### Task 4: Basketball adapter + recorded provider

**Files:**
- Create: `api/src/providers/api-basketball-provider.js`, `api/src/providers/recorded-basketball-provider.js`
- Test: `api/test/api-basketball-provider.test.js`

**Interfaces:**
- Produces:
  - `createApiBasketballProvider({ apiKey, fetch, retries, retryDelayMs, base = 'https://v1.basketball.api-sports.io' })` → adapter:
    - `sport: 'basketball'`, `dropUnknownTeams: true` (feed-born roster: schedule rows with unknown teams are dropped loudly, not asserted)
    - `fetchCompetitions()` → `GET /leagues` → `mapLeague[]`
    - `fetchCompetitors(comp)` → `GET /teams?league&season` → `mapBasketTeam[]` (nulls filtered)
    - `fetchSchedule(comp)` → `GET /games?league&season` → `mapGame[]`
    - `fetchResults(ids)` → one `GET /games?id=` per id (free tier has no `ids=`), flattened `mapGame[]`
    - `fetchStandings(comp)` → `GET /standings?league&season` → `response[0]` rows → `mapBasketStanding[]` (nulls filtered)
    - `resultToWinnerCode(game)` → `winnerSideToResult(game.winnerSide, 'basketball')`
    - `baseDetail(game)` → `game.detail`
    - NO `fetchLive` / `fetchOdds` / `fetchPredictions` / `fetchLineups` / `fetchEvents` / `fetchStatistics` / `fetchSquad` — their absence IS the capability gate.
  - `createRecordedBasketballProvider({ leagues, teams, games, standings })` — same interface from parsed JSON (mirror of the football recorded provider), same maps.
  - `comp` is a competition row; adapters read `comp.leagueId` and `comp.season` (both text).
- Consumes: `createApiSportsClient`, `winnerSideToResult` (Task 1); all Task 2/3 maps.

- [ ] **Step 1: Write the failing test**

```js
// api/test/api-basketball-provider.test.js
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createApiBasketballProvider } from '../src/providers/api-basketball-provider.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const COMP = { id: 'apibasketball:12:2023-2024', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024' }

test('live adapter calls the right endpoints with league+season and maps responses', async () => {
  const calls = []
  const provider = createApiBasketballProvider({
    apiKey: 'k',
    fetch: async (url) => {
      calls.push(url)
      const path = new URL(url).pathname
      const body = path === '/teams' ? load('teams') : path === '/games' ? load('games')
        : path === '/standings' ? load('standings') : load('leagues')
      return { ok: true, json: async () => body }
    },
  })
  const teams = await provider.fetchCompetitors(COMP)
  expect(teams).toHaveLength(30)
  expect(calls[0]).toBe('https://v1.basketball.api-sports.io/teams?league=12&season=2023-2024')
  const games = await provider.fetchSchedule(COMP)
  expect(games).toHaveLength(6)
  const standings = await provider.fetchStandings(COMP)
  expect(standings).toHaveLength(30)
  expect(provider.sport).toBe('basketball')
  expect(provider.fetchLive).toBeUndefined() // capability gate: no live polling
})

test('fetchResults loops single id= requests (no ids= on free tier)', async () => {
  const calls = []
  const provider = createApiBasketballProvider({
    apiKey: 'k',
    fetch: async (url) => {
      calls.push(url)
      const id = Number(new URL(url).searchParams.get('id'))
      const one = { ...load('games'), response: load('games').response.filter((g) => g.id === id) }
      return { ok: true, json: async () => one }
    },
  })
  const out = await provider.fetchResults(['372186', '372190'])
  expect(out.map((g) => g.id)).toEqual(['372186', '372190'])
  expect(calls).toEqual([
    'https://v1.basketball.api-sports.io/games?id=372186',
    'https://v1.basketball.api-sports.io/games?id=372190',
  ])
})

test('recorded provider serves the same interface from parsed JSON', async () => {
  const provider = createRecordedBasketballProvider({
    leagues: load('leagues'), teams: load('teams'), games: load('games'), standings: load('standings'),
  })
  expect((await provider.fetchCompetitions())[0].providerLeagueId).toBe(12)
  expect(await provider.fetchCompetitors(COMP)).toHaveLength(30)
  const games = await provider.fetchSchedule(COMP)
  expect(games).toHaveLength(6)
  expect(provider.resultToWinnerCode(games.find((g) => g.id === '372186'))).toBe('HOME')
  expect((await provider.fetchResults(['372190']))[0].id).toBe('372190')
  expect(provider.baseDetail(games[0])).toHaveProperty('quarters')
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

```js
// api/src/providers/api-basketball-provider.js
import { createApiSportsClient, winnerSideToResult } from './api-sports-base.js'
import { mapGame, mapBasketTeam, mapBasketStanding, mapLeague } from './basketball-mapping.js'

const BASE = 'https://v1.basketball.api-sports.io'

/** API-Basketball adapter. Baseline-sync-only: no fetchLive/odds/lineups capabilities —
 *  their absence gates NBA out of the live tick (owner decision; free tier has no live NBA). */
export function createApiBasketballProvider({ apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500, base = BASE }) {
  const { get } = createApiSportsClient({ base, apiKey, fetch, retries, retryDelayMs })
  return {
    sport: 'basketball',
    dropUnknownTeams: true, // feed-born roster: unknown teams in the schedule (All-Star) drop loudly
    async fetchCompetitions() {
      const j = await get('/leagues')
      return (j.response ?? []).map(mapLeague)
    },
    async fetchCompetitors(comp) {
      const j = await get('/teams', { league: comp.leagueId, season: comp.season })
      return (j.response ?? []).map(mapBasketTeam).filter(Boolean)
    },
    async fetchSchedule(comp) {
      const j = await get('/games', { league: comp.leagueId, season: comp.season })
      return (j.response ?? []).map(mapGame)
    },
    async fetchResults(ids) {
      // ponytail: single id= per call — free tier has no ids= batching; switch when a paid key lands
      const out = []
      for (const id of ids) {
        const j = await get('/games', { id })
        out.push(...(j.response ?? []).map(mapGame))
      }
      return out
    },
    async fetchStandings(comp) {
      const j = await get('/standings', { league: comp.leagueId, season: comp.season })
      return (j.response?.[0] ?? []).map(mapBasketStanding).filter(Boolean)
    },
    resultToWinnerCode(game) { return winnerSideToResult(game.winnerSide, 'basketball') },
    baseDetail(game) { return game.detail },
  }
}
```

```js
// api/src/providers/recorded-basketball-provider.js
import { winnerSideToResult } from './api-sports-base.js'
import { mapGame, mapBasketTeam, mapBasketStanding, mapLeague } from './basketball-mapping.js'

/** Build a basketball adapter from already-parsed raw API-Basketball JSON objects (tests + CLI dry runs). */
export function createRecordedBasketballProvider({ leagues, teams, games, standings } = {}) {
  return {
    sport: 'basketball',
    dropUnknownTeams: true,
    async fetchCompetitions() { return (leagues?.response ?? []).map(mapLeague) },
    async fetchCompetitors() { return (teams?.response ?? []).map(mapBasketTeam).filter(Boolean) },
    async fetchSchedule() { return (games?.response ?? []).map(mapGame) },
    async fetchResults(ids) {
      const want = new Set(ids.map(String))
      return (games?.response ?? []).filter((g) => want.has(String(g.id))).map(mapGame)
    },
    async fetchStandings() { return (standings?.response?.[0] ?? []).map(mapBasketStanding).filter(Boolean) },
    resultToWinnerCode(game) { return winnerSideToResult(game.winnerSide, 'basketball') },
    baseDetail(game) { return game.detail },
  }
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/providers/api-basketball-provider.js api/src/providers/recorded-basketball-provider.js api/test/api-basketball-provider.test.js && git commit -m "feat(providers): api-basketball adapter + recorded twin" && git push origin main`

---

### Task 5: Football adapter behind the interface

**Files:**
- Modify: `api/src/providers/api-football-provider.js`, `api/src/providers/recorded-provider.js`, `api/src/providers/mapping.js` (mapStanding gains rank/stats), `api/src/providers/football-provider.js` (typedef comment refresh)
- Modify (call sites): `api/src/worker/live-poller.js`, `api/src/worker/baseline-sync.js`, `api/src/worker/sync-teams.js`, `api/src/worker/crosswalk-sync.js`, `api/src/worker/cutover.js`, `api/src/worker/run-baseline.js` (only the method names listed below; deeper baseline surgery is Task 7)
- Test: `api/test/api-football-provider.test.js`, `api/test/mapping.test.js` (extend), plus the worker test files must stay green: `api/test/baseline-sync.test.js`, `api/test/baseline-prune.test.js`, `api/test/live-poller.test.js`, `api/test/reconcile-teams.test.js`, `api/test/sync-squads.test.js`, `api/test/crosswalk.test.js`

**Interfaces:**
- Produces (renames on BOTH football providers — live and recorded; call sites updated in the same commit):
  - `fetchFixtures(season)` → **`fetchSchedule(comp)`** (reads `Number(comp.season)` for the league param)
  - `fetchTeams(season)` → **`fetchCompetitors(comp)`**
  - `fetchFixturesByIds(ids)` → **`fetchResults(ids)`** (same ≤20 batching)
  - `fetchStandings(season)` → **`fetchStandings(comp)`**
  - new `fetchCompetitions()` → `GET /leagues?id=1` → `[{ providerLeagueId, name, type, logo, seasons }]` (same shape as basketball's `mapLeague`; football league rows nest `{league:{id,name,type,logo}, seasons:[…]}` — map accordingly)
  - new `sport: 'football'`, `groupsFromStandings: true` (soccer resolves group letters from /standings), `resultToWinnerCode(game)` = `winnerSideToResult(game.winnerSide, 'football')`, `baseDetail(f)`:

```js
baseDetail(f) {
  return {
    group: f.group, matchday: f.matchday, venue: f.venue, city: f.city,
    minute: f.minute ?? null, phase: f.phase ?? null,
    ht: f.htScore1 == null ? null : [f.htScore1, f.htScore2],
    reg: f.regScore1 == null ? null : [f.regScore1, f.regScore2],
    pen: f.penScore1 == null ? null : [f.penScore1, f.penScore2],
  }
}
```

  - capability extras keep their names: `fetchLive`, `fetchOdds`, `fetchPredictions`, `fetchLineups`, `fetchEvents`, `fetchStatistics`, `fetchSquad`.
- Produces: `mapStanding(raw)` now returns `{ providerTeamId, group, rank: null, pts: raw.points, stats: { played, win, draw, loss, gf, ga } }` — the flat `played/win/draw/loss/gf/ga/pts` fields are REMOVED (Task 7's baseline reads `s.pts`/`s.stats`; `sync-teams.js` only reads `s.group`/`s.providerTeamId`, unaffected). **Fix in passing:** `recorded-provider.js` imports the nonexistent `mapOdds` — change to `mapMarkets` (latent crash under plain Node; Vitest's transform masked it).
- Consumes: `createApiSportsClient`, `winnerSideToResult` (Task 1).

- [ ] **Step 1: Update tests first** — in `api/test/api-football-provider.test.js`, rename every `fetchFixtures(`/`fetchTeams(`/`fetchFixturesByIds(` call to the new names (pass `{ season: '2026', leagueId: '1' }`-shaped comp objects where a season was passed); in `api/test/mapping.test.js` re-key `mapStanding` assertions to `s.stats.win`/`s.pts`. Run both files — Expected: FAIL.
- [ ] **Step 2: Implement the renames** on `api-football-provider.js` (method bodies unchanged apart from `comp.season`), add `sport`/`groupsFromStandings`/`fetchCompetitions`/`resultToWinnerCode`/`baseDetail`; mirror on `recorded-provider.js` (also fix `mapOdds` → `mapMarkets`); update `mapStanding` in `mapping.js`.
- [ ] **Step 3: Sweep the call sites** — `grep -rn "fetchFixtures\|fetchTeams\|fetchFixturesByIds" api/src api/test` and rename every hit; where a caller passed `season`, pass a comp object (in `live-poller.js`: `provider.fetchResults(ids)`; in `baseline-sync.js`/`sync-teams.js`/`cutover.js`/`run-baseline.js` keep passing what they have — Task 7/11 finish their signatures; for now construct `{ season, leagueId: '1' }` inline at those call sites so behavior is identical).
- [ ] **Step 4: Run** — the six worker/provider test files above, then the FULL api suite. Expected: all green (some tests re-keyed, none deleted).
- [ ] **Step 5: Commit** — `git commit -am "refactor(providers): football adapter behind the registry interface" && git push origin main`

---

### Task 6: Provider registry

**Files:**
- Create: `api/src/providers/registry.js`
- Test: `api/test/registry.test.js`

**Interfaces:**
- Produces:
  - `providerFor(competition, { apiKey = process.env.API_FOOTBALL_KEY } = {})` → cached adapter by `competition.provider`; `'apifootball'` → `createApiFootballProvider`, `'apibasketball'` → `createApiBasketballProvider`; unknown → throw `unknown provider: <x>`.
  - `sportOf(providerKey)` → `'football' | 'basketball'` (throws on unknown) — the CLI uses it to fill `competition.sport`.
- Consumes: both adapters (Tasks 4, 5).

- [ ] **Step 1: Write the failing test**

```js
// api/test/registry.test.js
import { test, expect } from 'vitest'
import { providerFor, sportOf } from '../src/providers/registry.js'

test('providerFor returns the right adapter per provider key, cached', () => {
  const fb = providerFor({ provider: 'apifootball' }, { apiKey: 'k' })
  expect(fb.sport).toBe('football')
  expect(typeof fb.fetchLive).toBe('function') // football has live capability
  const bb = providerFor({ provider: 'apibasketball' }, { apiKey: 'k' })
  expect(bb.sport).toBe('basketball')
  expect(bb.fetchLive).toBeUndefined()
  expect(providerFor({ provider: 'apifootball' }, { apiKey: 'k' })).toBe(fb) // cached
  expect(() => providerFor({ provider: 'espn' }, { apiKey: 'k' })).toThrow(/unknown provider/)
})

test('sportOf maps provider keys to sports', () => {
  expect(sportOf('apifootball')).toBe('football')
  expect(sportOf('apibasketball')).toBe('basketball')
  expect(() => sportOf('espn')).toThrow(/unknown provider/)
})
```

- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Implement**

```js
// api/src/providers/registry.js
import { createApiFootballProvider } from './api-football-provider.js'
import { createApiBasketballProvider } from './api-basketball-provider.js'

const FACTORIES = {
  apifootball: { sport: 'football', create: createApiFootballProvider },
  apibasketball: { sport: 'basketball', create: createApiBasketballProvider },
}
const cache = new Map()

/** The adapter for a competition's provider (one instance per provider key). */
export function providerFor(competition, { apiKey = process.env.API_FOOTBALL_KEY } = {}) {
  const key = competition.provider
  const entry = FACTORIES[key]
  if (!entry) throw new Error(`unknown provider: ${key}`)
  if (!cache.has(key)) cache.set(key, entry.create({ apiKey }))
  return cache.get(key)
}

export function sportOf(providerKey) {
  const entry = FACTORIES[providerKey]
  if (!entry) throw new Error(`unknown provider: ${providerKey}`)
  return entry.sport
}
```

- [ ] **Step 4: Run it** — Expected: PASS. Full suite still green.
- [ ] **Step 5: Commit** — `git add api/src/providers/registry.js api/test/registry.test.js && git commit -m "feat(providers): registry — providerFor(competition)" && git push origin main`

---

### Task 7: syncBaseline generalization + newly-final detection

**Files:**
- Modify: `api/src/worker/baseline-sync.js`, `api/src/worker/run-baseline.js`
- Test: `api/test/baseline-sync.test.js`, `api/test/baseline-prune.test.js` (re-key signature), plus a new NBA case in `api/test/baseline-sync.test.js`

**Interfaces:**
- Produces: `syncBaseline(db, provider, competition)` — competition is the DB row (`{ id, provider, sport, leagueId, season }`); returns `{ fixtures, standings, newlyFinal }` where `newlyFinal` is an array of event ids whose status became `'final'` in this sync (previous row absent or non-final). Internals:
  - `fetchSchedule(competition)` / `fetchStandings(competition)`; syncLog `source: competition.provider`.
  - group-letters-from-standings block runs only `if (provider.groupsFromStandings)`.
  - roster resolution: `if (provider.dropUnknownTeams)` → filter out schedule games whose home/away provider id is not in the crosswalk, `console.warn` the dropped count (the NBA All-Star game path); else the existing `assertResolved` (curated football roster).
  - odds/predictions loop runs only `if (provider.fetchOdds)`.
  - winnerCode: `const side = provider.resultToWinnerCode(f)` → `side === 'HOME' ? f.t1Code : side === 'AWAY' ? f.t2Code : side === 'DRAW' ? 'DRAW' : null` (replaces the inline winnerSide ternary — the no-draw guard now fires inside the adapter).
  - detail: `const detail = { ...provider.baseDetail(f), derby: fl.derby, doubleOwner: fl.doubleOwner, ...(prob ? { prob } : {}), ...(m?.markets ? { markets: m.markets } : {}) }` (`computeFlags` stays for all sports — doubleOwner is sport-agnostic, derby just never matches for NBA).
  - newly-final: before the upsert loop, `const prior = new Map((await db.select({ id: event.id, status: event.status }).from(event).where(eq(event.competitionId, competition.id))).map((r) => [r.id, r.status]))`; after upserting, `newlyFinal = fixtures.filter((f) => f.status === 'final' && prior.get(f.id) !== 'final').map((f) => f.id)`.
  - standings upsert reads the new mapped shape: `values({ competitionId: competition.id, competitorCode: teamCode, rank: s.rank ?? null, points: s.pts, stats: s.stats, updatedAt: new Date() })` (+ same fields in the conflict set). NOTE: `ranking.rank` is written for the first time here — football rows keep `rank: null` (their order is computed client-side), NBA rows carry the conference position.
  - `backfillFinalEvents` best-effort block runs only `if (provider.fetchEvents)`.
- Consumes: adapters (Tasks 4–6). `refundPrunedParlays` scope, `resolveCrosswalk`, `detailMerge`, `competitorCodeMap` — unchanged.

- [ ] **Step 1: Re-key the existing tests** — in `baseline-sync.test.js` and `baseline-prune.test.js`, replace every `syncBaseline(db, provider, { season: 2026, competitionId: COMPETITION_ID })` with `syncBaseline(db, provider, FOOTBALL_COMP)` where

```js
const FOOTBALL_COMP = { id: 'apifootball:1:2026', provider: 'apifootball', sport: 'football', leagueId: '1', season: '2026' }
```

  and assert the result now also has `newlyFinal` (`expect(r.newlyFinal).toEqual(expect.any(Array))`). Run — FAIL (old signature).

- [ ] **Step 2: Add the NBA baseline test** — append to `baseline-sync.test.js`:

```js
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { competition, competitor, ranking } from '../src/db/schema.js'
import { syncCompetitors } from '../src/worker/sync-competitors.js' // Task 8 — see note below

const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_COMP = { id: 'apibasketball:12:2023-2024', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024' }

test('NBA baseline: drops All-Star game, writes 2-way finals + conference rankings, reports newlyFinal', async () => {
  const provider = createRecordedBasketballProvider({
    leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings'),
  })
  await db.insert(competition).values({ ...NBA_COMP, format: 'league', name: 'NBA' }).onConflictDoNothing()
  await syncCompetitors(db, provider, NBA_COMP)
  try {
    const r = await syncBaseline(db, provider, NBA_COMP)
    expect(r.fixtures).toBe(5) // 6 recorded − All-Star (East/West unknown teams dropped)
    expect(r.newlyFinal).toHaveLength(5)
    const evs = await db.select().from(event).where(eq(event.competitionId, NBA_COMP.id))
    expect(evs).toHaveLength(5)
    for (const ev of evs) {
      expect(ev.status).toBe('final')
      expect([ev.c1Code, ev.c2Code]).toContain(ev.winnerCode) // 2-way: winner is always a competitor, never 'DRAW'
    }
    const aot = evs.find((ev) => ev.id === '372190')
    expect(aot.detail.ot).not.toBeNull()
    expect(aot.detail.quarters.home).toHaveLength(4)
    const rows = await db.select().from(ranking).where(eq(ranking.competitionId, NBA_COMP.id))
    expect(rows).toHaveLength(30)
    const withRank = rows.filter((x) => x.rank != null)
    expect(withRank).toHaveLength(30) // conference positions land in ranking.rank
    expect(rows[0].stats).toHaveProperty('pct')
  } finally {
    // teardown so later test files see only the Phase-1 seed
    await db.delete(event).where(eq(event.competitionId, NBA_COMP.id))
    await db.delete(ranking).where(eq(ranking.competitionId, NBA_COMP.id))
    await db.delete(competitor).where(eq(competitor.competitionId, NBA_COMP.id))
    await db.delete(competition).where(eq(competition.id, NBA_COMP.id))
  }
})
```

  Run — FAIL (`sync-competitors.js` missing and `syncBaseline` unported). **Sequencing note:** Tasks 7 and 8 are one TDD arc — this test is the RED for both; implement Task 7's port first (the test then fails only on the missing `syncCompetitors`), then Task 8 turns it green. Commit at each task boundary regardless (Task 7's commit carries the still-red NBA test — mark it `test.skip` for the Task 7 commit and unskip it in Task 8's, so main stays green).

- [ ] **Step 3: Port `syncBaseline`** per the Interfaces block (mechanical: thread `competition`, gate the four football-only blocks, swap winnerCode/detail/standings assembly, add the prior-status diff).
- [ ] **Step 4: Update `run-baseline.js`** — pass the full competition row:

```js
import { asc } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { providerFor } from '../providers/registry.js'
import { syncBaseline } from './baseline-sync.js'
import { competition } from '../db/schema.js'

const pool = createPool()
const db = createDb(pool)
try {
  // ponytail: single-competition CLI; parameterize when self-serve lands (P3)
  const [comp] = await db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1)
  if (!comp) { console.error('no competition found — run competition:add or db:seed first'); process.exit(1) }
  const r = await syncBaseline(db, providerFor(comp), comp)
  console.log(`baseline sync ok: ${r.fixtures} fixtures, ${r.standings} standings, ${r.newlyFinal.length} newly final`)
} catch (e) {
  console.error('baseline sync FAILED (last-good data left intact):', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
```

- [ ] **Step 5: Run** — `npx vitest run test/baseline-sync.test.js test/baseline-prune.test.js` (NBA test skipped), then the full api suite. Expected: green.
- [ ] **Step 6: Commit** — `git commit -am "refactor(worker): syncBaseline takes the competition row, reports newly-final events" && git push origin main`

---

### Task 8: syncCompetitors — feed-born rosters

**Files:**
- Create: `api/src/worker/sync-competitors.js`
- Test: `api/test/sync-competitors.test.js`; unskip the NBA baseline test from Task 7

**Interfaces:**
- Produces: `syncCompetitors(db, provider, competition)` → `{ inserted, updated, deleted }`:
  - fetches `fetchCompetitors(comp)` + `fetchStandings(comp)` (conference per provider id from `s.group`).
  - match existing rows by `competitor.providerId`; matched → update `name`, `logo`, `meta` merge `{ conference }`.
  - new → insert `{ id: 'cp_' + competition.id + '_' + code, competitionId, code: slugName(name), name, color: colorFor(code), logo, providerId, meta: { conference } }`; slug collisions get `-2`, `-3`… suffixes.
  - rows whose providerId left the feed → delete (ownership by competitorId, ranking by code, then the competitor — same order as `sync-teams.js`).
  - `slugName('Oklahoma City Thunder') === 'oklahoma-city-thunder'` (lowercase, NFD-strip accents, non-alphanumerics → `-`, trim `-`).
  - `colorFor(code)` — deterministic: `\`hsl(${hash % 360} 65% 45%)\`` with a simple char-code hash; competitor.color is NOT NULL and the web tints by it.
- Consumes: basketball adapter (Task 4). Football never calls this (curated seed + reconcile-teams stays the reference path).

- [ ] **Step 1: Write the failing test**

```js
// api/test/sync-competitors.test.js
import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor } from '../src/db/schema.js'
import { syncCompetitors, slugName } from '../src/worker/sync-competitors.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA = { id: 'apibasketball:12:2023-2024', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024' }

afterAll(async () => {
  await db.delete(competitor).where(eq(competitor.competitionId, NBA.id))
  await db.delete(competition).where(eq(competition.id, NBA.id))
  await pool.end()
})

test('slugName produces stable url/wire-safe codes', () => {
  expect(slugName('Oklahoma City Thunder')).toBe('oklahoma-city-thunder')
  expect(slugName('Portland Trail Blazers')).toBe('portland-trail-blazers')
})

test('syncCompetitors inserts the 30 franchises with conference meta, then deletes leavers', async () => {
  await db.insert(competition).values({ ...NBA, format: 'league', name: 'NBA' }).onConflictDoNothing()
  const provider = createRecordedBasketballProvider({ teams: load('teams'), standings: load('standings') })
  const r1 = await syncCompetitors(db, provider, NBA)
  expect(r1).toMatchObject({ inserted: 30, deleted: 0 })
  const rows = await db.select().from(competitor).where(eq(competitor.competitionId, NBA.id))
  expect(rows).toHaveLength(30)
  const okc = rows.find((c) => c.code === 'oklahoma-city-thunder')
  expect(okc.providerId).toBe(152)
  expect(okc.meta.conference).toBe('Western Conference')
  expect(okc.color).toMatch(/^hsl\(/)
  expect(okc.logo).toMatch(/^https:/)

  // second run: idempotent updates, no dupes
  const r2 = await syncCompetitors(db, provider, NBA)
  expect(r2).toMatchObject({ inserted: 0, updated: 30, deleted: 0 })

  // a team leaving the feed is deleted
  const teams31 = structuredClone(load('teams'))
  teams31.response = teams31.response.filter((t) => t.id !== 152)
  const r3 = await syncCompetitors(db, createRecordedBasketballProvider({ teams: teams31, standings: load('standings') }), NBA)
  expect(r3.deleted).toBe(1)
  expect(await db.select().from(competitor).where(eq(competitor.competitionId, NBA.id))).toHaveLength(29)
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/worker/sync-competitors.js
import { and, eq, sql } from 'drizzle-orm'
import { competitor, ownership, ranking } from '../db/schema.js'

/** Lowercase, strip accents, collapse non-alphanumerics to single hyphens. */
export function slugName(name) {
  return (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
}

/** Deterministic team tint — the web colors by competitor.color (NOT NULL). */
export function colorFor(code) {
  let h = 0
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 65% 45%)`
}

/**
 * Reconcile a FEED-BORN competition's competitor rows straight from the provider
 * (football's curated seed + reconcile-teams path is separate by design).
 * Match by providerId; insert new with slug codes; delete leavers + their ownership/ranking.
 */
export async function syncCompetitors(db, provider, comp) {
  const [teams, standings, ours] = await Promise.all([
    provider.fetchCompetitors(comp),
    provider.fetchStandings(comp),
    db.select().from(competitor).where(eq(competitor.competitionId, comp.id)),
  ])
  const conferenceByProvider = new Map(standings.map((s) => [s.providerTeamId, s.group]))
  const oursByProviderId = new Map(ours.filter((c) => c.providerId != null).map((c) => [c.providerId, c]))
  const usedCodes = new Set(ours.map((c) => c.code))
  let inserted = 0, updated = 0, deleted = 0

  const seen = new Set()
  for (const t of teams) {
    seen.add(t.providerTeamId)
    const conference = conferenceByProvider.get(t.providerTeamId) ?? null
    const mine = oursByProviderId.get(t.providerTeamId)
    if (mine) {
      await db.update(competitor)
        .set({ name: t.name, logo: t.logo, meta: sql`coalesce(${competitor.meta}, '{}'::jsonb) || ${JSON.stringify({ conference })}::jsonb` })
        .where(eq(competitor.id, mine.id))
      updated++
    } else {
      let code = slugName(t.name) || `t${t.providerTeamId}`
      let i = 2
      while (usedCodes.has(code)) code = `${slugName(t.name)}-${i++}`
      usedCodes.add(code)
      await db.insert(competitor).values({
        id: `cp_${comp.id}_${code}`, competitionId: comp.id, code, name: t.name,
        color: colorFor(code), logo: t.logo, providerId: t.providerTeamId, meta: { conference },
      })
      inserted++
    }
  }

  for (const c of ours) {
    if (c.providerId != null && !seen.has(c.providerId)) {
      await db.delete(ownership).where(eq(ownership.competitorId, c.id))
      await db.delete(ranking).where(and(eq(ranking.competitionId, comp.id), eq(ranking.competitorCode, c.code)))
      await db.delete(competitor).where(eq(competitor.id, c.id))
      deleted++
    }
  }
  return { inserted, updated, deleted }
}
```

- [ ] **Step 4: Unskip the NBA baseline test** from Task 7 and run — `npx vitest run test/sync-competitors.test.js test/baseline-sync.test.js` — Expected: PASS. Then full api suite.
- [ ] **Step 5: Commit** — `git add api/src/worker/sync-competitors.js api/test/sync-competitors.test.js api/test/baseline-sync.test.js && git commit -m "feat(worker): feed-born competitor sync (slug codes, conference meta)" && git push origin main`

---

### Task 9: hasDraws consumer — support route rejects DRAW picks for no-draw sports

**Files:**
- Modify: `api/src/routes/social.js`
- Test: `api/test/competition-scope.test.js` (extend — it already owns a second-competition harness)

**Interfaces:**
- Consumes: `sportConfig` (sports.js), `competition` table.
- Produces: `POST /api/support` with `teamCode: 'DRAW'` → 400 `{ error: 'invalid_team' }` when the sweep's competition sport has `hasDraws: false`. Football behavior byte-identical (the competition lookup happens only on a DRAW pick).

- [ ] **Step 1: Write the failing test** — append to `api/test/competition-scope.test.js` (its OTHER competition is already `sport: 'basketball'`; add a sweep bound to it plus a person, then a DRAW pick; note the event under OTHER is `upcoming` with `stage: 'group'`, so today's rule would accept DRAW):

```js
import { sweep } from '../src/db/schema.js' // add to the existing schema import line

test('POST /api/support rejects a DRAW pick for a no-draw sport', async () => {
  await db.insert(sweep).values({ id: 'sw_nba', name: 'NBA sweep', kind: 'token', memberToken: 'nbamember', adminToken: 'nbaadmin', competitionId: OTHER }).onConflictDoNothing()
  await db.insert(person).values({ id: 'pn_nba', sweepId: 'sw_nba', name: 'Nia', short: 'Nia', initials: 'NI', avColor: '#123' }).onConflictDoNothing()
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/support',
      headers: { 'x-sweep-token': 'nbamember' },
      payload: { fixtureId: 'evO_1', personId: 'pn_nba', teamCode: 'DRAW' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_team')
    // a real team pick on the same sweep/event still works
    const ok = await app.inject({
      method: 'POST', url: '/api/support',
      headers: { 'x-sweep-token': 'nbamember' },
      payload: { fixtureId: 'evO_1', personId: 'pn_nba', teamCode: 'lal' },
    })
    expect(ok.statusCode).toBe(200)
  } finally {
    await db.delete(support).where(eq(support.sweepId, 'sw_nba'))
    await db.delete(person).where(eq(person.sweepId, 'sw_nba'))
    await db.delete(sweep).where(eq(sweep.id, 'sw_nba'))
  }
})
```

  (Check how member tokens authenticate in `api/test/sweeps-isolation.test.js` first — if it's a cookie or different header, mirror that exact mechanism.)

- [ ] **Step 2: Run it** — Expected: FAIL (today DRAW on a group-stage event is accepted → 200).

- [ ] **Step 3: Implement** — in `api/src/routes/social.js`:

```js
import { person, support, competition } from '../db/schema.js'
import { sportConfig } from '../sports.js'
// in the POST handler, replace the validPick line:
    let validPick = teamCode === f.t1Code || teamCode === f.t2Code
    if (!validPick && teamCode === DRAW && f.stage === 'group') {
      // draw picks only exist in sports that can draw (football); NBA etc. are 2-way
      const [comp] = await app.db.select({ sport: competition.sport }).from(competition)
        .where(eq(competition.id, req.sweep.competitionId))
      validPick = comp ? sportConfig(comp.sport).hasDraws : false
    }
```

- [ ] **Step 4: Run** — `npx vitest run test/competition-scope.test.js test/social.test.js` then the full suite. Expected: PASS (football social tests unchanged).
- [ ] **Step 5: Commit** — `git commit -am "feat(api): support picks honor hasDraws — no DRAW in 2-way sports" && git push origin main`

---

### Task 10: hasDraws consumer — recomputeStandings is football-only

**Files:**
- Modify: `api/src/worker/recompute-standings.js`
- Test: `api/test/recompute-standings.test.js` (extend)

**Interfaces:**
- Produces: `recomputeStandings(db, competitionId)` returns `0` and writes nothing when the competition's sport is not `'football'` (NBA rankings are provider-authoritative, refreshed by baseline; the W/D/L 3-points math is soccer's).
- Consumes: `competition` table.

- [ ] **Step 1: Write the failing test** — append to `api/test/recompute-standings.test.js` (reuse its db handle; insert a minimal basketball competition + final event, expect no ranking rows):

```js
import { competition, competitor } from '../src/db/schema.js'

test('recomputeStandings is a no-op for non-football competitions', async () => {
  const NBA = 'apibasketball:12:test'
  await db.insert(competition).values({ id: NBA, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'test', format: 'league', name: 'NBA' }).onConflictDoNothing()
  await db.insert(competitor).values([
    { id: `cp_${NBA}_aa`, competitionId: NBA, code: 'aa', name: 'Aa', color: '#111' },
    { id: `cp_${NBA}_bb`, competitionId: NBA, code: 'bb', name: 'Bb', color: '#222' },
  ])
  await db.insert(event).values({ id: 'ev_nba_rc', competitionId: NBA, c1Code: 'aa', c2Code: 'bb', startUtc: new Date(), status: 'final', score1: 100, score2: 90, winnerCode: 'aa', stage: 'group', detail: {} })
  try {
    expect(await recomputeStandings(db, NBA)).toBe(0)
    expect(await db.select().from(ranking).where(eq(ranking.competitionId, NBA))).toHaveLength(0)
  } finally {
    await db.delete(event).where(eq(event.id, 'ev_nba_rc'))
    await db.delete(competitor).where(eq(competitor.competitionId, NBA))
    await db.delete(competition).where(eq(competition.id, NBA))
  }
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (it currently writes 2 ranking rows).
- [ ] **Step 3: Implement** — head of `recomputeStandings`:

```js
import { competition } from '../db/schema.js'
// first lines of the function:
  const [comp] = await db.select({ sport: competition.sport }).from(competition).where(eq(competition.id, competitionId))
  if (comp?.sport !== 'football') return 0 // provider standings are authoritative for other sports
```

- [ ] **Step 4: Run** — the file, then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(worker): recomputeStandings only rebuilds football tables" && git push origin main`

---

### Task 11: Worker orchestration — registry + newly-final chain + capability gate

**Files:**
- Modify: `api/src/worker.js`
- Test: none new (glue — its pieces are tested in Tasks 7–10; verified by boot in Task 14). `node --check` + full suite.

**Interfaces:**
- Consumes: `providerFor` (Task 6), `syncBaseline(db, provider, competition)` → `{ …, newlyFinal }` (Task 7), `recomputeStandings` guard (Task 10).
- Produces: worker behavior —
  - `activeCompetitions(db)` now returns competition ROWS: `select().from(competition).where(inArray(competition.id, db.selectDistinct(sweep.competitionId).from(sweep).where(isNull(sweep.archivedAt))))` (keep it as two queries if the subquery fights drizzle: ids first, then `inArray` rows fetch; empty ids → `[]` early return, never `inArray(col, [])`).
  - `baseline(reason)`: per competition row → `const provider = providerFor(comp)`; `syncBaseline(db, provider, comp)`; then the newly-final chain for `r.newlyFinal`: `recomputeStandings(db, comp.id)` once if any, then per event id `settleBets` + `grantMatchRewards` each in its own try/catch (copy the exact pattern from the live tick), then `publish({ type: 'sync' })`.
  - live tick: first line inside the per-competition loop: `const provider = providerFor(comp); if (!provider.fetchLive) continue // baseline-only sport (NBA)`.
  - delete the module-level `const season = Number(process.env.WC_SEASON ?? 2026)` and the module-level `provider` — `WC_SEASON` dies (season lives on the competition row); the boot log becomes `console.log('worker up')`.
- Note: the existing debounced `scheduleFinalReconcile` and `settleStale` cron stay untouched.

- [ ] **Step 1: Port `worker.js`** per the Interfaces block.
- [ ] **Step 2: Static check** — `cd api && node --check src/worker.js` — Expected: exit 0.
- [ ] **Step 3: Full suite** — `npm run test` from repo root — Expected: green (the worker entry is not directly tested).
- [ ] **Step 4: Grep for WC_SEASON stragglers** — `grep -rn "WC_SEASON" api/ --include='*.js' -l` — expected: no hits under `api/src` (`.env` may keep the var; it's now unread).
- [ ] **Step 5: Commit** — `git commit -am "refactor(worker): per-competition providers, newly-final chain, live-tick capability gate" && git push origin main`

---

### Task 12: competition:add CLI

**Files:**
- Create: `api/src/worker/add-competition.js`
- Modify: `api/package.json` (script `"competition:add": "node --env-file=../.env src/worker/add-competition.js"`)
- Test: `api/test/add-competition.test.js`

**Interfaces:**
- Produces:
  - `addCompetition(db, provider, { provider: providerKey, leagueId, season })` (exported for tests) → creates the `competition` row (id `\`${providerKey}:${leagueId}:${season}\``, sport from `sportOf(providerKey)`, `format: league.type === 'League' ? 'league' : 'groups_then_ko'`, name/logo from the catalog), runs `syncCompetitors` then `syncBaseline`; returns `{ competitionId, competitors, fixtures }`. Throws `league ${leagueId} not found in ${providerKey} catalog` when `fetchCompetitions()` has no matching `providerLeagueId`; throws `competition already exists: ${id}` on a duplicate (check before insert).
  - CLI wrapper (bottom of the same file, guarded by `import.meta.url === \`file://${process.argv[1]}\``): args `process.argv[2..4]` = providerKey, leagueId, season; missing args → usage line + exit 1; uses `providerFor({ provider: providerKey })` and prints the summary.
- Consumes: `providerFor`/`sportOf` (Task 6), `syncCompetitors` (Task 8), `syncBaseline` (Task 7).

- [ ] **Step 1: Write the failing test**

```js
// api/test/add-competition.test.js
import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { competition, competitor, event, ranking } from '../src/db/schema.js'
import { addCompetition } from '../src/worker/add-competition.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const ID = 'apibasketball:12:2023-2024'
const provider = () => createRecordedBasketballProvider({
  leagues: load('leagues'), teams: load('teams'), games: load('games'), standings: load('standings'),
})

afterAll(async () => {
  await db.delete(event).where(eq(event.competitionId, ID))
  await db.delete(ranking).where(eq(ranking.competitionId, ID))
  await db.delete(competitor).where(eq(competitor.competitionId, ID))
  await db.delete(competition).where(eq(competition.id, ID))
  await pool.end()
})

test('addCompetition provisions competition + competitors + events + rankings in one shot', async () => {
  const r = await addCompetition(db, provider(), { provider: 'apibasketball', leagueId: '12', season: '2023-2024' })
  expect(r).toMatchObject({ competitionId: ID, competitors: 30, fixtures: 5 })
  const [comp] = await db.select().from(competition).where(eq(competition.id, ID))
  expect(comp).toMatchObject({ provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024', format: 'league', name: 'NBA' })
  expect(comp.logo).toMatch(/^https:/)
  await expect(addCompetition(db, provider(), { provider: 'apibasketball', leagueId: '12', season: '2023-2024' }))
    .rejects.toThrow(/already exists/)
})

test('addCompetition rejects a league missing from the catalog', async () => {
  await expect(addCompetition(db, provider(), { provider: 'apibasketball', leagueId: '999', season: '2023-2024' }))
    .rejects.toThrow(/not found/)
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/worker/add-competition.js
import { eq } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { providerFor, sportOf } from '../providers/registry.js'
import { syncCompetitors } from './sync-competitors.js'
import { syncBaseline } from './baseline-sync.js'
import { competition } from '../db/schema.js'

/** Provision a competition from the provider catalog: row + competitors + first baseline. */
export async function addCompetition(db, provider, { provider: providerKey, leagueId, season }) {
  const leagues = await provider.fetchCompetitions()
  const league = leagues.find((l) => String(l.providerLeagueId) === String(leagueId))
  if (!league) throw new Error(`league ${leagueId} not found in ${providerKey} catalog`)
  const id = `${providerKey}:${leagueId}:${season}`
  const [existing] = await db.select().from(competition).where(eq(competition.id, id))
  if (existing) throw new Error(`competition already exists: ${id}`)
  const comp = {
    id, provider: providerKey, sport: sportOf(providerKey), leagueId: String(leagueId), season: String(season),
    format: league.type === 'League' ? 'league' : 'groups_then_ko', name: league.name, logo: league.logo,
  }
  await db.insert(competition).values(comp)
  const c = await syncCompetitors(db, provider, comp)
  const b = await syncBaseline(db, provider, comp)
  return { competitionId: id, competitors: c.inserted + c.updated, fixtures: b.fixtures }
}

// CLI: npm run competition:add -w api -- <provider> <leagueId> <season>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [providerKey, leagueId, season] = process.argv.slice(2)
  if (!providerKey || !leagueId || !season) {
    console.error('usage: npm run competition:add -w api -- <apifootball|apibasketball> <leagueId> <season>')
    process.exit(1)
  }
  const pool = createPool()
  const db = createDb(pool)
  try {
    const r = await addCompetition(db, providerFor({ provider: providerKey }), { provider: providerKey, leagueId, season })
    console.log(`added ${r.competitionId}: ${r.competitors} competitors, ${r.fixtures} fixtures`)
  } catch (e) {
    console.error('competition:add FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
```

- [ ] **Step 4: Add the npm script** to `api/package.json` next to `"sync"`.
- [ ] **Step 5: Run** — the test file, then the full suite. Expected: PASS.
- [ ] **Step 6: Commit** — `git add api/src/worker/add-competition.js api/test/add-competition.test.js api/package.json && git commit -m "feat(worker): competition:add CLI provisions from the provider catalog" && git push origin main`

---

### Task 13: End-to-end NBA proof (recorded feed)

**Files:**
- Test: `api/test/nba-e2e.test.js` (new — pure test, no src changes expected; any failure here is a bug to fix in the task that owns it)

**Interfaces:**
- Consumes: everything above. This is the phase's proof obligation — competition from feed → sweep → ownership/support → finals → 2-way settlement → rankings, all over the FROZEN wire shapes.

- [ ] **Step 1: Write the test** (it should pass immediately if Tasks 1–12 are correct; treat a failure as a real bug, not a test to adjust):

```js
// api/test/nba-e2e.test.js
import { test, expect, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { competition, competitor, event, ranking, sweep, person, ownership, bet, coinLedger, support } from '../src/db/schema.js'
import { addCompetition } from '../src/worker/add-competition.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { settleBets } from '../src/coins/settle.js'
import { recomputeStandings } from '../src/worker/recompute-standings.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { publish: async () => {} })
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const ID = 'apibasketball:12:2023-2024'
const M = { headers: { 'x-sweep-token': 'nbaM' } } // adjust to the real token mechanism from sweeps tests

// two snapshots of the same feed: everything upcoming, then the real (final) capture
const upcomingGames = () => {
  const j = structuredClone(load('games'))
  for (const g of j.response) {
    g.status = { long: 'Not Started', short: 'NS', timer: null }
    for (const side of ['home', 'away']) g.scores[side] = { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, over_time: null, total: null }
  }
  return j
}
const recorded = (games) => createRecordedBasketballProvider({ leagues: load('leagues'), teams: load('teams'), games, standings: load('standings') })

beforeAll(async () => { await app.ready() })
afterAll(async () => {
  await db.delete(support).where(eq(support.sweepId, 'sw_nbae2e'))
  await db.delete(bet).where(eq(bet.sweepId, 'sw_nbae2e'))
  await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'sw_nbae2e'))
  await db.delete(ownership).where(eq(ownership.sweepId, 'sw_nbae2e'))
  await db.delete(person).where(eq(person.sweepId, 'sw_nbae2e'))
  await db.delete(sweep).where(eq(sweep.id, 'sw_nbae2e'))
  await db.delete(event).where(eq(event.competitionId, ID))
  await db.delete(ranking).where(eq(ranking.competitionId, ID))
  await db.delete(competitor).where(eq(competitor.competitionId, ID))
  await db.delete(competition).where(eq(competition.id, ID))
  await app.close(); await pool.end()
})

test('NBA end to end: provision → sweep → ownership/support → finals → 2-way settlement + rankings', async () => {
  // 1. provision from the (upcoming) feed
  const r = await addCompetition(db, recorded(upcomingGames()), { provider: 'apibasketball', leagueId: '12', season: '2023-2024' })
  expect(r.fixtures).toBe(5)
  let evs = await db.select().from(event).where(eq(event.competitionId, ID))
  expect(evs.every((e) => e.status === 'upcoming' && e.winnerCode == null)).toBe(true)

  // 2. a sweep bound to it, with a member and an owned team
  await db.insert(sweep).values({ id: 'sw_nbae2e', name: 'NBA E2E', kind: 'token', memberToken: 'nbaM', adminToken: 'nbaA', competitionId: ID })
  await db.insert(person).values({ id: 'pn_e2e', sweepId: 'sw_nbae2e', name: 'Evie', short: 'Evie', initials: 'EV', avColor: '#333' })
  const [wolves] = await db.select().from(competitor).where(and(eq(competitor.competitionId, ID), eq(competitor.code, 'minnesota-timberwolves')))
  await db.insert(ownership).values({ sweepId: 'sw_nbae2e', personId: 'pn_e2e', competitorId: wolves.id })

  // 3. wire reads through the frozen contract
  const fixtures = await app.inject({ method: 'GET', url: '/api/fixtures', ...M })
  expect(fixtures.statusCode).toBe(200)
  expect(fixtures.json()).toHaveLength(5)
  expect(fixtures.json()[0]).toHaveProperty('t1Code') // soccer field names, NBA data — by design

  // 4. support a team; DRAW is refused (no-draw sport)
  const pick = await app.inject({ method: 'POST', url: '/api/support', ...M, payload: { fixtureId: '372186', personId: 'pn_e2e', teamCode: 'minnesota-timberwolves' } })
  expect(pick.statusCode).toBe(200)
  const draw = await app.inject({ method: 'POST', url: '/api/support', ...M, payload: { fixtureId: '372186', personId: 'pn_e2e', teamCode: 'DRAW' } })
  expect(draw.statusCode).toBe(400)

  // 5. an open bet on the game (inserted directly — NBA feed carries no odds; markets are P5)
  await db.insert(coinLedger).values({ sweepId: 'sw_nbae2e', personId: 'pn_e2e', type: 'grant', amount: 1000, refId: '0' })
  await db.insert(coinLedger).values({ sweepId: 'sw_nbae2e', personId: 'pn_e2e', type: 'stake', amount: -100, refId: 'bet_e2e' })
  await db.insert(bet).values({ id: 'bet_e2e', sweepId: 'sw_nbae2e', personId: 'pn_e2e', fixtureId: '372186', market: 'toq', selection: 'HOME', stake: 100, oddsDecimal: '1.9', potentialPayout: 190, status: 'open' })

  // 6. results land via baseline; newly-final reported; settlement grades 2-way
  const sync = await syncBaseline(db, recorded(load('games')), (await db.select().from(competition).where(eq(competition.id, ID)))[0])
  expect(sync.newlyFinal).toHaveLength(5)
  evs = await db.select().from(event).where(eq(event.competitionId, ID))
  for (const e of evs.filter((x) => x.status === 'final')) expect(e.winnerCode).not.toBe('DRAW')
  await settleBets(db, '372186', async () => {})
  const [graded] = await db.select().from(bet).where(eq(bet.id, 'bet_e2e'))
  expect(graded.status).toBe('won') // Wolves won 111–99; 'toq' grades on fixtureResult/winnerCode
  // recompute must NOT touch provider-authoritative NBA rankings
  expect(await recomputeStandings(db, ID)).toBe(0)
  const rows = await db.select().from(ranking).where(eq(ranking.competitionId, ID))
  expect(rows).toHaveLength(30)
  expect(rows.every((x) => x.rank != null && x.stats.pct != null)).toBe(true)
})
```

  (Before running: check the real member-token mechanism in `api/test/sweeps-isolation.test.js` and adjust `M`; check `settleBets`'s exact signature in `api/src/coins/settle.js`.)

- [ ] **Step 2: Run it** — `npx vitest run test/nba-e2e.test.js` — Expected: PASS. If it fails, STOP and fix the owning module (with its own failing unit test first), then re-run.
- [ ] **Step 3: Full suites** — `npm run test` AND `npm test -w web` — Expected: api green, web exactly 436 unmodified.
- [ ] **Step 4: Commit** — `git add api/test/nba-e2e.test.js && git commit -m "test(api): NBA end-to-end proof over the frozen wire contract" && git push origin main`

---

### Task 14: Live NBA into the dev DB + boot verification

**Files:** none committed (verification; fix-forward commits if anything surfaces).

- [ ] **Step 1: Verify the DB target** — `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'` → MUST print `sweep_platform`; anything else: STOP.
- [ ] **Step 2: Provision live NBA** — `npm run competition:add -w api -- apibasketball 12 2023-2024` (~4 live requests: leagues, teams, games, standings — free-tier budget is 100/day). Expected output: `added apibasketball:12:2023-2024: 30 competitors, ~1330 fixtures` (1377 raw − All-Star/unknown-team games dropped, count logged).
- [ ] **Step 3: Bind a sweep** — start the api (`npm run dev:api` in background), then `POST /api/super/sweeps` with `{ "name": "NBA proof", "competitionId": "apibasketball:12:2023-2024" }` using the super-admin auth found in `api/test/sweeps-admin.test.js`; note the returned member link.
- [ ] **Step 4: Poke the wire** — with the member token: `GET /api/fixtures` (~1330 rows, `t1Code`-shaped), `GET /api/standings` (conference-keyed tables), `GET /api/fixtures/<some id>` 200 for an NBA id and **404 for a World-Cup event id** (scoping proof). Verify the seeded football default sweep still serves its data untouched.
- [ ] **Step 5: Build + suites** — `npm run build`, `npm run test`, `npm test -w web`. Expected: build ok, api green, web 436.
- [ ] **Step 6: Stop the server; report** — suite counts, boot evidence, dropped-game count, any deviation. `git status` clean; push.

---

### Task 15: Carried-over cleanups (non-blocking batch)

**Files:**
- Modify: `api/src/worker/run-squads.js`, `api/src/worker/run-stats-backfill.js`, `api/src/worker/crosswalk-sync.js` (loud no-competition guards, mirroring Task 7's run-baseline guard: `if (!comp) { console.error('no competition found — run competition:add or db:seed first'); process.exit(1) }`)
- Modify: `api/src/routes/sweeps.js` (`POST /api/super/sweeps` with an unknown `competitionId`: `select` it first; missing → 400 `{ error: 'unknown_competition' }` instead of the FK 500)
- Modify: `api/src/worker/live-poller.js` (`pollLineups`: flatten the row before the `if (f.lineups)` guard or add the comment explaining the caller's pre-filter contract — read it and pick the smaller diff)
- Modify: `api/src/worker/reconcile-teams.js` (drop the unconsumed `flagCode` from inserts)
- Delete: `api/src/seed/import-roster.js` (pre-existing missing-sweepId bug, untested, unused CLI — fix-or-delete decision: delete; `git log` keeps it)
- Test: `api/test/sweeps-admin.test.js` (extend for the 400)

- [ ] **Step 1: Failing test for the 400** — append to `api/test/sweeps-admin.test.js` (mirror its existing super-auth pattern): POST `/api/super/sweeps` with `{ name: 'X', competitionId: 'nope:0:0' }` → expect 400 `{ error: 'unknown_competition' }`. Run — FAIL (today: FK violation → 500).
- [ ] **Step 2: Implement the 400**; make the three CLI guards; drop `flagCode`; delete `import-roster.js`; `grep -rn "import-roster" api/` → no hits.
- [ ] **Step 3: Read `pollLineups`** in `api/src/worker/live-poller.js`; apply the smaller of flatten-before-guard vs contract comment.
- [ ] **Step 4: Run the full api suite + web suite.** Expected: green / 436.
- [ ] **Step 5: Commit** — `git commit -am "chore(api): carried-over cleanups — CLI guards, super-create 400, dead code" && git push origin main`

---

## Self-Review (done at write time)

- **Spec coverage:** registry+interface (T6, T4, T5), base adapter + field maps (T1–T3), football ported behind interface (T5), capability gating incl. live tick (T4, T11), baseline generalization + newly-final chain + rewards-gap fix (T7, T11), feed-born competitors w/ slug codes + conference meta (T8), hasDraws end to end — adapter guard (T1/T2), support route (T9), recompute guard (T10), league_topN-shaped rankings with rank+pct stats (T3, T7), provisioning CLI, no UI (T12), e2e proof (T13), live dev-DB seed + boot (T14), web untouched (global constraint, checked T13/T14). Design §11 out-of-scope items have no tasks — correct.
- **Placeholder scan:** none; every code step is complete.
- **Type consistency:** mapped-game core fields (`homeProviderId/awayProviderId/kickoffUtc/status/winnerSide/score1/score2/stage`) shared by both maps and consumed by T7's spine; `mapStanding`'s new `{rank, pts, stats}` shape consumed by T7 and tolerated by `sync-teams` (reads only `group`/`providerTeamId`); `fetchResults(ids)` used by live-poller (T5) and recorded providers (T4/T5); `syncBaseline(db, provider, competition)` signature consistent across T7/T11/T12/T13; `sportConfig` consumed in T1/T9/T10.
- **Known judgment calls (flagged, not hidden):** Tasks 7+8 share one TDD arc (skip/unskip protocol keeps main green); T13 may surface integration bugs — instruction is fix-in-owner-module, not adjust-the-test; football `ranking.rank` stays null (client sorts).

---

## Post-implementation follow-ups (final whole-branch review, 2026-07-04)

Branch landed as commits `eb3b233..c6a712d` (gate ×3, docs, fixtures, 15 tasks,
1 final-review fix). All tasks individually reviewed; final review verdict:
READY TO MERGE. The one Important finding (cross-provider event-id collision →
opaque FK failure) was fixed same-session as `c6a712d`: syncBaseline now
refuses foreign-owned event ids with a named error before any upsert.

**P3 gate candidate — before a THIRD provider lands:**
- `event.id` is a bare cross-provider keyspace (football ~1.1M+ vs basketball
  ~400k today — disjoint, and the `c6a712d` guard fails loud on collision).
  Real fix: namespace non-football event ids or composite PK. Decide at P3.

**Follow-up tickets (non-blocking):**
- `cutover.js` assumes the earliest competition is football — provisioned
  NBA-first it would wipe NBA events; filter `sport='football'` or take an arg.
- Football `fetchCompetitions` hardcodes `/leagues?id=1` → "league X not found"
  is misleading for any other football league; `fetchLive` is now a dead-code
  capability marker (gate reads its existence, `pollLive` uses `fetchResults`)
  — replace with an explicit `live: true` flag when touched. Both are P3
  catalog-work adjacent.
- Worker never re-runs `syncCompetitors` (CLI-only); fine for NBA, revisit for
  roster-churn sports. Related pre-existing hazard: deleting a competitor with
  historical event rows FK-violates (both sync paths).
- `providerFor` cache ignores `apiKey` after first call (matters only for
  multi-tenant keys, P4+).
- Test-coverage nits: live-verify the hand-built `apifootball/leagues.json`
  fixture (1 free API call); league-param tests beyond `fetchSchedule`;
  `pollLineups` raw-row-shape test; `String(season)` numeric branch;
  `winnerSideToResult` garbage-input fallthrough.
- Local env: `.env` still carries `PLATFORM_HOST=localhost:3000` (pre-existing)
  — plain-localhost requests resolve as platform host, so default-sweep reads
  need a non-platform Host header in dev.

Accepted as designed: NBA `/api/standings` sorts alphabetically within
conference groups (points/gd are soccer math; rank column unused by the route —
P6 reskin owns sport-driven tables); NBA sweeps expose no betting markets
(feed has no NBA odds — P5); `run-squads` duplicate competition lookup.
