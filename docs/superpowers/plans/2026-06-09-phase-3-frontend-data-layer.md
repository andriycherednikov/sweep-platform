# Phase 3 — Frontend Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static, hardcoded `web/src/data.js` with a live data layer that fetches the six read endpoints, assembles the **exact same `SWEEP`-shaped object** the components already consume, and renders loading / error / "scores may be delayed" states — so the ~1,650 lines of components barely change.

**Architecture:** A pure **assembler** turns the API responses into the `SWEEP` shape (the same derivation `data.js` does today: link owners, sort standings, compute derby/double-owner, rank "in the money", precompute Sydney time labels). `data.js` is rewritten to a tiny **store** that holds a live `SWEEP` object + the pure helpers, populated by `setSweepData()`. A `SweepProvider` (TanStack Query) fetches everything once, assembles, populates the store, and gates the app behind a loading shell; errors get an inline retry, and `/api/sync-status` drives a global stale banner. Components keep `import { SWEEP as S } from "./data.js"` unchanged. SSE / optimistic writes / server-backed social are **Phase 4** — not here.

**Tech Stack:** Vite + React 18, `@tanstack/react-query` v5, native `fetch` (Vite proxies `/api` → :3000), Vitest + `@testing-library/react` + `jsdom` for web tests.

---

## Context: what exists today

- `web/src/data.js` (280 lines) = **two halves**:
  1. **Generation** (lines ~1–266): seeded RNG → `teams`, `people`, `fixtures`, `standings`, `photos`, plus derivation (`ownersByTeam`, derby/`doubleOwners`, `money`, `titleOdds`/`outlook`, time labels). The generation is now served by the API; the **derivation logic is reused** by the assembler.
  2. **Export** (lines ~268–281): `export const SWEEP = { teams, teamList, groups, people, fixtures, standings, photos, derbies, money, nextMatch, liveMatch, team, flag, gd, ownersOf, ownersForFixture, fmtTime, fmtDay, fmtDayKey, fmtWeekday, todayKey }`.
- **Consumers** (all `import { SWEEP as S } from "./data.js"`): `components.jsx`, `screens-main.jsx`, `screens-detail.jsx`, and `social.js`. The components read `S.*` only inside render. `social.js` is the **only module-scope reader** (`S.nextMatch.id`, `S.liveMatch`, `S.people`) — it must be adjusted.
- **`SWEEP` members the components actually use** (from a full grep): `S.team(code)` (×23), `S.flag(code,size)` (×15), `S.fixtures` (×7), `S.gd(t)` (×6), `S.standings` (×5), `S.photos` (×4), `S.groups` (×4), `S.people` (×3), `S.ownersForFixture(f)` (×3), `S.todayKey` (×2), `S.teamList` (×2), `S.money` (×2), `S.nextMatch` (×1), plus `S.liveMatch` and `S.ownersOf` via `social.js`.
- **Exact shapes the assembler must reproduce** (read `web/src/data.js` to confirm):
  - team object: `{ code, name, group, pool, color, strength, win, draw, loss, gf, ga, pts, played, owners:[person], titleOdds, outlook }`
  - person: `{ id, name, short, initials, av, teams:[code] }` (the API field is `av`; `avatarPath` also present)
  - fixture: `{ id, group, matchday, t1, t2, ko:Date, venue, city, status, score:[a,b]|null, minute, prob:{a,d,b}, derby:bool, doubleOwners:[person], timeLabel, dayLabel, dayKey }`
  - `standings`: `{ A:[team], …, L:[team] }` sorted by pts, gd, gf, name
  - `money`: `[{ person, team, odds, strength, rank, tag }]` sorted desc by strength
  - `photos`: `[{ id, uploader, team, caption, status, src }]`
- **API responses** (Phase 1, verified live): `GET /api/bootstrap` → `{ teams:[{code,name,group,pool,color,strength}], people:[{id,name,short,initials,av,avatarPath}], ownership:{personId:[code]}, scoring }`; `GET /api/fixtures` → `[{id,group,matchday,t1,t2,ko,venue,city,status,score,minute,prob:{a,d,b},stage,derby,doubleOwner}]` (ordered by kickoff); `GET /api/standings` → `{ group:[{code,name,played,win,draw,loss,gf,ga,gd,pts}] }`; `GET /api/people` → people with `teams`; `GET /api/photos` → approved `[{id,kind,uploader,team,caption,src,status}]`; `GET /api/sync-status` → `{ stale, lastBaselineAt, lastLiveAt }`.

> The site reads **only** our API (the cache is the contract). Real data is already live in the DB (48 teams, 72 fixtures, 48 people, 96 picks). All fixtures are currently `upcoming` (tournament hasn't kicked off), so `liveMatch` will be null and standings all-zero until matches play — that is correct.

---

## File Structure

```
web/
  package.json                 + @tanstack/react-query; + devDeps vitest, jsdom, @testing-library/react, @testing-library/jest-dom; + "test" script
  vitest.config.js             (new) jsdom env + setup
  test/setup.js                (new) jest-dom matchers
  src/
    lib/
      format.js                (new) pure: flag, gd, fmtTime/fmtDay/fmtDayKey/fmtWeekday  (lifted from data.js)
      assemble.js              (new) pure: assembleSweep(api) → SWEEP shape   ← the core
      assemble.test.js         (new) unit tests against sample API payloads
    api/
      client.js                (new) fetch wrappers for the 6 endpoints + sync-status
      client.test.js           (new) unit tests (mocked fetch)
    data.js                    (rewrite) tiny store: live `SWEEP` + helpers + setSweepData()
    SweepProvider.jsx          (new) QueryClient + fetch+assemble+gate + stale banner
    components.jsx             (modify) add a <Shimmer>/<ErrorState>/<StaleBanner> set OR import from SweepProvider
    social.js                  (modify) drop module-scope demo seeds; read live S.people safely
    main.jsx                   (modify) wrap <App/> in <SweepProvider>
```

---

## Task 1: Web test tooling + React Query dependency

**Files:** Modify `web/package.json`; Create `web/vitest.config.js`, `web/test/setup.js`, `web/src/lib/smoke.test.js`

- [ ] **Step 1: Add deps + test script to `web/package.json`**

Add to `dependencies`: `"@tanstack/react-query": "^5.62.0"`. Add to `devDependencies`: `"vitest": "^2.1.8"`, `"jsdom": "^25.0.1"`, `"@testing-library/react": "^16.1.0"`, `"@testing-library/jest-dom": "^6.6.3"`. Add to `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Create `web/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test/setup.js'] },
})
```

- [ ] **Step 3: Create `web/test/setup.js`**

```js
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Create a smoke test `web/src/lib/smoke.test.js`**

```js
import { expect, test } from 'vitest'
test('vitest runs in jsdom', () => {
  expect(typeof document).toBe('object')
})
```

- [ ] **Step 5: Install and run**

Run: `npm install && npm run test -w web`
Expected: PASS (1 test). jsdom env works.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(web): add vitest+jsdom+RTL and @tanstack/react-query"
```

---

## Task 2: Pure format helpers (lifted from data.js)

**Files:** Create `web/src/lib/format.js`, `web/src/lib/format.test.js`

- [ ] **Step 1: Write the failing test `web/src/lib/format.test.js`**

```js
import { expect, test } from 'vitest'
import { flag, gd, fmtTime, fmtDay, fmtDayKey, fmtWeekday } from './format.js'

test('flag builds flagcdn urls (gb- subteams use svg)', () => {
  expect(flag('hr')).toBe('https://flagcdn.com/w80/hr.png')
  expect(flag('gb-eng')).toBe('https://flagcdn.com/gb-eng.svg')
})

test('gd is goal difference', () => {
  expect(gd({ gf: 5, ga: 2 })).toBe(3)
})

test('Sydney formatters are stable for a known instant', () => {
  const d = new Date('2026-06-13T06:30:00Z') // 16:30 Sydney (UTC+10)
  expect(fmtDayKey(d)).toBe('2026-06-13')
  expect(fmtWeekday(d)).toBe('Saturday')
  expect(fmtDay(d)).toMatch(/Sat/)
  expect(fmtTime(d)).toMatch(/4:30/)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w web -- format`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/format.js`** (lifted verbatim from `web/src/data.js`)

```js
const SYD = 'Australia/Sydney'

export function flag(code, size) {
  size = size || 80
  if (code.indexOf('gb-') === 0) return 'https://flagcdn.com/' + code + '.svg'
  return 'https://flagcdn.com/w' + size + '/' + code + '.png'
}

export function gd(t) { return t.gf - t.ga }

export function fmtTime(d) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: SYD, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase().replace(/\s/, ' ')
}
export function fmtDay(d) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: SYD, weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}
export function fmtDayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYD, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function fmtWeekday(d) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: SYD, weekday: 'long' }).format(d)
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w web -- format`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): extract pure format/flag/gd helpers from data.js"
```

---

## Task 3: API client

**Files:** Create `web/src/api/client.js`, `web/src/api/client.test.js`

- [ ] **Step 1: Write the failing test `web/src/api/client.test.js`**

```js
import { expect, test, vi, beforeEach } from 'vitest'
import { fetchBootstrap, fetchFixtures, fetchStandings, fetchPhotos, fetchSyncStatus, fetchAll } from './client.js'

beforeEach(() => { vi.restoreAllMocks() })

function mockJson(map) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (path in map) return { ok: true, status: 200, json: async () => map[path] }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
}

test('fetchBootstrap hits /api/bootstrap and returns json', async () => {
  mockJson({ '/api/bootstrap': { teams: [], people: [], ownership: {}, scoring: null } })
  const b = await fetchBootstrap()
  expect(b).toEqual({ teams: [], people: [], ownership: {}, scoring: null })
})

test('a non-ok response throws', async () => {
  mockJson({})
  await expect(fetchStandings()).rejects.toThrow(/standings/i)
})

test('fetchAll resolves the whole bundle in parallel', async () => {
  mockJson({
    '/api/bootstrap': { teams: [{ code: 'hr' }], people: [], ownership: {}, scoring: { rule: 'top3' } },
    '/api/fixtures': [{ id: '1' }],
    '/api/standings': { A: [] },
    '/api/photos': [],
    '/api/sync-status': { stale: false, lastBaselineAt: null, lastLiveAt: null },
  })
  const all = await fetchAll()
  expect(all.bootstrap.teams).toHaveLength(1)
  expect(all.fixtures).toHaveLength(1)
  expect(all.syncStatus.stale).toBe(false)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w web -- client`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/api/client.js`**

```js
async function get(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`)
  return res.json()
}

export const fetchBootstrap = () => get('/api/bootstrap')
export const fetchFixtures = () => get('/api/fixtures')
export const fetchStandings = () => get('/api/standings')
export const fetchPhotos = () => get('/api/photos')
export const fetchSyncStatus = () => get('/api/sync-status')

/** Everything the SWEEP shape needs, fetched in parallel. */
export async function fetchAll() {
  const [bootstrap, fixtures, standings, photos, syncStatus] = await Promise.all([
    fetchBootstrap(), fetchFixtures(), fetchStandings(), fetchPhotos(), fetchSyncStatus(),
  ])
  return { bootstrap, fixtures, standings, photos, syncStatus }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w web -- client`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): API client for the six read endpoints + sync-status"
```

---

## Task 4: The assembler (pure) — API payloads → SWEEP shape

**Files:** Create `web/src/lib/assemble.js`, `web/src/lib/assemble.test.js`

> This reproduces `data.js`'s derivation exactly, but sourced from the API. Read `web/src/data.js` lines ~180–230 (standings sort, derby/doubleOwners, money/titleOdds/outlook) — the logic below is lifted from there.

- [ ] **Step 1: Write the failing test `web/src/lib/assemble.test.js`**

```js
import { expect, test } from 'vitest'
import { assembleSweep } from './assemble.js'

const api = {
  bootstrap: {
    teams: [
      { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#d8334a', strength: 80 },
      { code: 'gh', name: 'Ghana', group: 'L', pool: 'B', color: '#1f8a4c', strength: 65 },
      { code: 'br', name: 'Brazil', group: 'C', pool: 'A', color: '#f3c318', strength: 88 },
    ],
    people: [
      { id: 'p1', name: 'Andriy Cherednikov', short: 'Andriy C.', initials: 'AC', av: '#c9472f', avatarPath: null },
      { id: 'p2', name: 'Priya', short: 'Priya', initials: 'PR', av: '#3b6fd1', avatarPath: null },
    ],
    ownership: { p1: ['hr'], p2: ['hr', 'br'] },
    scoring: { rule: 'top3', coOwners: 'all_win' },
  },
  fixtures: [
    { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'gh', ko: '2026-06-13T09:00:00.000Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 60, d: 22, b: 18 }, stage: 'group', derby: false, doubleOwner: false },
  ],
  standings: {
    L: [
      { code: 'hr', name: 'Croatia', played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
      { code: 'gh', name: 'Ghana', played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
    ],
    C: [{ code: 'br', name: 'Brazil', played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0 }],
  },
  photos: [{ id: 'ph1', kind: 'fan', uploader: 'Priya', team: 'hr', caption: 'hi', src: '/photos/seed/ph1.jpg', status: 'approved' }],
  syncStatus: { stale: false, lastBaselineAt: null, lastLiveAt: null },
}

test('assembles teams keyed by code with owners and stats', () => {
  const S = assembleSweep(api)
  expect(S.team('hr').name).toBe('Croatia')
  expect(S.team('hr').owners.map((o) => o.id).sort()).toEqual(['p1', 'p2'])
  expect(typeof S.team('hr').titleOdds).toBe('number')
})

test('people carry their team codes', () => {
  const S = assembleSweep(api)
  expect(S.people.find((p) => p.id === 'p2').teams).toEqual(['hr', 'br'])
})

test('fixtures get Date kickoff, time labels, and derby/owners from ownership', () => {
  const S = assembleSweep(api)
  const f = S.fixtures[0]
  expect(f.ko instanceof Date).toBe(true)
  expect(typeof f.dayKey).toBe('string')
  expect(f.t1).toBe('hr')
  // hr owned (p1,p2), gh unowned → not a derby
  expect(f.derby).toBe(false)
  const owners = S.ownersForFixture(f)
  expect(owners.t1.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  expect(owners.t2).toEqual([])
})

test('standings are grouped and money is ranked by best-team strength', () => {
  const S = assembleSweep(api)
  expect(Object.keys(S.standings)).toEqual(expect.arrayContaining(['L', 'C']))
  expect(S.money[0].strength).toBeGreaterThanOrEqual(S.money[1].strength)
  expect(S.money[0].person).toBeTruthy()
})

test('derby true when both sides owned by different people', () => {
  const api2 = JSON.parse(JSON.stringify(api))
  api2.bootstrap.ownership = { p1: ['hr'], p2: ['gh'] } // hr vs gh both owned
  const S = assembleSweep(api2)
  expect(S.fixtures[0].derby).toBe(true)
  expect(S.fixtures[0].doubleOwners).toEqual([]) // nobody owns both
})

test('groups/teamList/photos/helpers exposed; liveMatch null when none live', () => {
  const S = assembleSweep(api)
  expect(S.groups).toContain('L')
  expect(S.teamList.length).toBe(3)
  expect(S.photos[0].src).toBe('/photos/seed/ph1.jpg')
  expect(S.flag('hr')).toContain('flagcdn')
  expect(S.liveMatch).toBeNull()
  expect(S.nextMatch).toBeTruthy()
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w web -- assemble`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/assemble.js`**

```js
import { flag, gd, fmtTime, fmtDay, fmtDayKey, fmtWeekday } from './format.js'

function outlookFor(s) {
  return s >= 86 ? 'Title contender' : s >= 80 ? 'Last-8 shout' : s >= 73 ? 'Knockout dark horse' : s >= 66 ? 'Group toss-up' : 'Long shot'
}
function titleOddsFor(s) {
  return Math.max(1, Math.round(Math.pow(Math.max(0, s - 50), 2) / 14))
}

/**
 * Pure: turn the API bundle ({bootstrap, fixtures, standings, photos, syncStatus})
 * into the SWEEP-shaped object the components consume.
 */
export function assembleSweep(api) {
  const { bootstrap, fixtures: rawFixtures, standings: rawStandings, photos: rawPhotos } = api

  // people (carry their team codes from ownership)
  const ownership = bootstrap.ownership || {}
  const people = bootstrap.people.map((p) => ({
    id: p.id, name: p.name, short: p.short, initials: p.initials, av: p.av, avatarPath: p.avatarPath,
    teams: ownership[p.id] ? ownership[p.id].slice() : [],
  }))
  const peopleById = Object.fromEntries(people.map((p) => [p.id, p]))

  // owners by team code
  const ownersByTeam = {}
  for (const p of people) for (const code of p.teams) (ownersByTeam[code] = ownersByTeam[code] || []).push(p)
  const ownersOf = (code) => ownersByTeam[code] || []

  // standings stats by code (from /api/standings rows)
  const statByCode = {}
  for (const g of Object.keys(rawStandings)) for (const row of rawStandings[g]) statByCode[row.code] = row

  // teams keyed by code (full objects: meta + stats + owners + outlook)
  const teams = {}
  for (const t of bootstrap.teams) {
    const s = statByCode[t.code] || { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
    teams[t.code] = {
      code: t.code, name: t.name, group: t.group, pool: t.pool, color: t.color, strength: t.strength,
      played: s.played, win: s.win, draw: s.draw, loss: s.loss, gf: s.gf, ga: s.ga, pts: s.pts,
      owners: ownersOf(t.code), titleOdds: titleOddsFor(t.strength), outlook: outlookFor(t.strength),
    }
  }
  const team = (code) => teams[code]
  const teamList = Object.keys(teams).map((c) => teams[c])
  const groups = [...new Set(teamList.map((t) => t.group))].sort()

  // standings grouped + sorted (pts, gd, gf, name)
  const standings = {}
  for (const t of teamList) (standings[t.group] = standings[t.group] || []).push(teams[t.code])
  for (const g of Object.keys(standings)) {
    standings[g].sort((x, y) => (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf) || x.name.localeCompare(y.name))
  }

  // fixtures: Date kickoff + time labels + derby/doubleOwners from ownership
  const fixtures = rawFixtures.map((f) => {
    const ko = new Date(f.ko)
    const o1 = ownersOf(f.t1), o2 = ownersOf(f.t2)
    const derby = o1.length > 0 && o2.length > 0
    const doubleOwners = o1.filter((p) => o2.indexOf(p) >= 0)
    return {
      id: f.id, group: f.group, matchday: f.matchday, t1: f.t1, t2: f.t2, ko,
      venue: f.venue, city: f.city, status: f.status, score: f.score, minute: f.minute,
      prob: f.prob, stage: f.stage, derby, doubleOwners,
      timeLabel: fmtTime(ko), dayLabel: fmtDay(ko), dayKey: fmtDayKey(ko),
    }
  })
  fixtures.sort((a, b) => a.ko - b.ko)
  const ownersForFixture = (f) => ({ t1: ownersOf(f.t1), t2: ownersOf(f.t2) })
  const derbies = fixtures.filter((f) => f.derby)

  // live / next match (real data: first live, else first upcoming, else first)
  const liveMatch = fixtures.find((f) => f.status === 'live') || null
  const nextMatch = fixtures.find((f) => f.status === 'upcoming') || fixtures[0] || null

  // "in the money": rank people by their best owned team's strength
  const money = people.map((p) => {
    const best = p.teams.map((c) => teams[c]).filter(Boolean).sort((a, b) => b.strength - a.strength)[0]
    return { person: p, team: best || null, odds: best ? best.titleOdds : 0, strength: best ? best.strength : 0 }
  }).sort((a, b) => b.strength - a.strength)
  money.forEach((m, i) => { m.rank = i + 1; m.tag = i === 0 ? 'Title fav' : m.strength >= 70 ? 'Alive' : 'Outside' })

  // photos (already approved-only from the API)
  const photos = (rawPhotos || []).map((ph) => ({
    id: ph.id, uploader: ph.uploader, team: ph.team, caption: ph.caption, status: ph.status, src: ph.src, kind: ph.kind,
  }))

  const todayKey = fmtDayKey(new Date())

  return {
    teams, teamList, groups, people, peopleById, fixtures, standings, photos, derbies, money,
    nextMatch, liveMatch, scoring: bootstrap.scoring,
    team, flag, gd, ownersOf, ownersForFixture, fmtTime, fmtDay, fmtDayKey, fmtWeekday, todayKey,
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w web -- assemble`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): pure assembler turning API payloads into the SWEEP shape"
```

---

## Task 5: Rewrite `data.js` into a live store

**Files:** Modify `web/src/data.js` (full rewrite); Test `web/src/data.test.js`

> Keep the module path + the `SWEEP` export so every consumer's `import { SWEEP as S } from "./data.js"` is unchanged. `SWEEP` starts as a safe empty shape (empty collections, working helpers) and is filled by `setSweepData()` before the app renders.

- [ ] **Step 1: Write the failing test `web/src/data.test.js`**

```js
import { expect, test } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'

test('SWEEP is safe before data loads (empty collections, working helpers)', () => {
  expect(Array.isArray(SWEEP.people)).toBe(true)
  expect(SWEEP.people).toHaveLength(0)
  expect(SWEEP.flag('hr')).toContain('flagcdn')
  expect(SWEEP.team('hr')).toBeUndefined()
  expect(SWEEP.nextMatch).toBeNull()
})

test('setSweepData fills the SAME SWEEP reference (identity preserved)', () => {
  const ref = SWEEP
  setSweepData(assembleSweep({
    bootstrap: { teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }], people: [], ownership: {}, scoring: null },
    fixtures: [], standings: { L: [] }, photos: [], syncStatus: { stale: false },
  }))
  expect(SWEEP).toBe(ref)            // same object reference
  expect(SWEEP.team('hr').name).toBe('Croatia')
  expect(SWEEP.teamList).toHaveLength(1)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w web -- data`
Expected: FAIL — `setSweepData` not exported.

- [ ] **Step 3: Rewrite `web/src/data.js`**

```js
import { flag, gd, fmtTime, fmtDay, fmtDayKey, fmtWeekday } from './lib/format.js'

// Safe empty shape so module-scope reads never crash before data loads.
function emptySweep() {
  return {
    teams: {}, teamList: [], groups: [], people: [], peopleById: {},
    fixtures: [], standings: {}, photos: [], derbies: [], money: [],
    nextMatch: null, liveMatch: null, scoring: null,
    team: (code) => SWEEP.teams[code],
    ownersOf: (code) => (SWEEP._ownersByTeam && SWEEP._ownersByTeam[code]) || [],
    ownersForFixture: (f) => ({ t1: SWEEP.ownersOf(f.t1), t2: SWEEP.ownersOf(f.t2) }),
    flag, gd, fmtTime, fmtDay, fmtDayKey, fmtWeekday,
    todayKey: fmtDayKey(new Date()),
  }
}

export const SWEEP = emptySweep()

const DATA_KEYS = [
  'teams', 'teamList', 'groups', 'people', 'peopleById', 'fixtures', 'standings',
  'photos', 'derbies', 'money', 'nextMatch', 'liveMatch', 'scoring', 'todayKey',
]

const socialListeners = new Set()
export function onSweepData(fn) { socialListeners.add(fn); return () => socialListeners.delete(fn) }

/** Replace the live data on the SAME SWEEP object (identity preserved for existing imports). */
export function setSweepData(assembled) {
  for (const k of DATA_KEYS) SWEEP[k] = assembled[k]
  // keep helpers bound to the assembled closures where they need its private maps
  SWEEP.team = assembled.team
  SWEEP.ownersOf = assembled.ownersOf
  SWEEP.ownersForFixture = assembled.ownersForFixture
  socialListeners.forEach((fn) => fn())
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w web -- data`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): turn data.js into a live SWEEP store (setSweepData)"
```

---

## Task 6: Decouple `social.js` from module-scope generation

**Files:** Modify `web/src/social.js`; Test `web/src/social.test.js`

> Today `social.js` seeds watchers/support at import time using `S.nextMatch.id` and demo person ids — that crashes against the empty initial `SWEEP`. Drop the demo seeds (Phase 4 brings real, server-backed social); keep the localStorage behaviour; read `S.people` lazily (inside functions, after data loads).

- [ ] **Step 1: Write the failing test `web/src/social.test.js`**

```js
import { expect, test, beforeEach } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { getMe, setMe, watchersOf, toggleWatch, isWatching } from './social.js'

beforeEach(() => {
  localStorage.clear()
  setSweepData(assembleSweep({
    bootstrap: { teams: [], people: [{ id: 'p1', name: 'Andriy', short: 'Andriy', initials: 'A', av: '#000', avatarPath: null }], ownership: {}, scoring: null },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
})

test('no identity by default until set; setMe/getMe round-trip', () => {
  setMe('p1')
  expect(getMe().id).toBe('p1')
})

test('watchers start empty and toggle for the current person', () => {
  setMe('p1')
  expect(watchersOf('m1')).toEqual([])
  toggleWatch('m1')
  expect(isWatching('m1')).toBe(true)
  expect(watchersOf('m1').map((p) => p.id)).toEqual(['p1'])
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w web -- social`
Expected: FAIL — module currently crashes/loads demo seeds referencing `S.nextMatch.id`.

- [ ] **Step 3: Edit `web/src/social.js`** — make these changes:
  1. Change the default identity so nobody is auto-selected: `let meId = (_meRaw === null) ? null : (_meRaw === 'none' ? null : _meRaw)` (was defaulting to `"p4"`).
  2. Delete the `seedWatchers`/`seedSupport` blocks (the lines building them from `S.nextMatch`/`S.liveMatch`) and initialise empty: `let watchers = loadJSON(WATCH_KEY, {})` and `let support = loadJSON(SUP_KEY, {})`.
  3. Leave `watchersOf`/`supportOf`/`getMe` as-is — they already read `S.people` lazily inside the function body, which is now populated before render.

(No other lines change. The result: `social.js` no longer touches `SWEEP` at import time.)

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w web -- social`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): decouple social.js from static seeds; localStorage-only until Phase 4"
```

---

## Task 7: `SweepProvider` — fetch, assemble, gate, stale banner

**Files:** Create `web/src/SweepProvider.jsx`; Test `web/src/SweepProvider.test.jsx`

- [ ] **Step 1: Write the failing test `web/src/SweepProvider.test.jsx`**

```js
import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SweepProvider } from './SweepProvider.jsx'
import { SWEEP } from './data.js'

const bundle = {
  '/api/bootstrap': { teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }], people: [], ownership: {}, scoring: { rule: 'top3' } },
  '/api/fixtures': [], '/api/standings': { L: [] }, '/api/photos': [],
  '/api/sync-status': { stale: true, lastBaselineAt: null, lastLiveAt: null },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
})

test('shows a loading state, then renders children with data populated + stale banner', async () => {
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  expect(screen.getByTestId('sweep-loading')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(SWEEP.team('hr').name).toBe('Croatia')
  expect(screen.getByTestId('stale-banner')).toBeInTheDocument() // syncStatus.stale === true
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -w web -- SweepProvider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/SweepProvider.jsx`**

```jsx
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fetchAll } from './api/client.js'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000, refetchOnWindowFocus: false } } })

function Gate({ children }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sweep'],
    queryFn: async () => {
      const api = await fetchAll()
      setSweepData(assembleSweep(api))
      return api.syncStatus
    },
  })

  if (isLoading) {
    return (
      <div data-testid="sweep-loading" className="sweep-loading">
        <div className="spinner" /> Loading the sweep…
      </div>
    )
  }
  if (isError) {
    return (
      <div data-testid="sweep-error" className="sweep-error">
        <p>Couldn’t load the sweep.</p>
        <button onClick={() => refetch()}>Retry</button>
      </div>
    )
  }
  return (
    <>
      {data?.stale && (
        <div data-testid="stale-banner" className="stale-banner">Scores may be delayed</div>
      )}
      {children}
    </>
  )
}

export function SweepProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate>{children}</Gate>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test -w web -- SweepProvider`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): SweepProvider — fetch+assemble, loading/error gate, stale banner"
```

---

## Task 8: Wire it into the app, style the new states, verify

**Files:** Modify `web/src/main.jsx`; Modify `web/src/styles.css` (add loading/error/stale styles); no component logic changes.

- [ ] **Step 1: Wrap `<App/>` in `web/src/main.jsx`**

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import "./styles.css";
import "./desktop.css";

ReactDOM.createRoot(document.getElementById("appmount")).render(
  <SweepProvider><App /></SweepProvider>
);
```

- [ ] **Step 2: Add styles to `web/src/styles.css`** (append; match the Matchday look — dark bg, accent)

```css
.sweep-loading, .sweep-error { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; min-height:100dvh; color:var(--ink, #e7e9ee); background:var(--bg, #0d1017); font-weight:600; }
.sweep-loading .spinner { width:34px; height:34px; border-radius:50%; border:3px solid rgba(255,255,255,.15); border-top-color:var(--accent, #36c); animation:sweepspin .8s linear infinite; }
@keyframes sweepspin { to { transform:rotate(360deg); } }
.sweep-error button { padding:10px 18px; border-radius:10px; border:0; background:var(--accent, #36c); color:#fff; font-weight:700; }
.stale-banner { position:sticky; top:0; z-index:40; text-align:center; padding:7px 12px; font-size:13px; font-weight:700; background:#7a5a12; color:#ffe9b3; }
```

- [ ] **Step 3: Build the production bundle**

Run: `npm run build`
Expected: Vite build succeeds (`web/dist/` produced), no errors.

- [ ] **Step 4: Manual smoke against the live API** (the real `sweep` DB is seeded)

```bash
# terminal 1
npm run dev:api
# terminal 2
npm run dev:web      # Vite serves on 5173, proxies /api → :3000
```
Open the printed Vite URL. Expected: brief loading state → the app renders with **real** data — 48 people on the People screen, real teams/groups on Standings, real fixtures on Schedule. Toggling "watching" on a match persists per device. (All fixtures are `upcoming`, so no live tickers yet — correct.)

- [ ] **Step 5: Full web test suite**

Run: `npm run test -w web`
Expected: all green (smoke, format, client, assemble, data, social, SweepProvider).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): mount SweepProvider + loading/error/stale styles"
```

---

## Done criteria for Phase 3

- `npm run test -w web` is green (assembler, client, format, store, social, provider).
- `npm run build` succeeds; with `npm run dev:api` + `npm run dev:web`, the site renders **real** sweep data fetched from the API — `data.js` no longer generates anything, it just holds what the API returns.
- Loading shell on first paint; inline retry on a failed fetch; a "scores may be delayed" banner when `/api/sync-status` reports `stale:true`.
- The ~1,650 lines of components are untouched (their `import { SWEEP as S } from "./data.js"` still works); `social.js` is localStorage-only and no longer crashes at import.
- **Next phase (4):** social layer + SSE — `watch`/`support` endpoints, `GET /api/stream`, a `useEventStream` hook that invalidates the React Query cache, optimistic updates, and the worker's live poller pushing score events. The `onSweepData` listener hook added in Task 5 is the seam SSE will plug into.

---

## Open items to confirm while executing

- **CSS variables:** the loading/stale styles reference `--bg/--ink/--accent`; confirm the real variable names in `web/src/styles.css` and match them (the Matchday palette already defines the app's colors).
- **`peopleById`** is added to the SWEEP shape for convenience (used by `social`/future SSE); harmless if unused by current components.
- **Empty/zero state:** standings are all-zero and `liveMatch` is null until the tournament starts — verify the existing components render that gracefully (they were built to show upcoming fixtures, so they should).
- **First-run identity:** default identity is now *none* (was demo `p4`); the "Who are you?" sheet should prompt on first social action — confirm `window.__sweepPickMe` still fires.
