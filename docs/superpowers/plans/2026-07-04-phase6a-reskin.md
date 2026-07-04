# Phase 6a — Frontend Reskin + Account/Billing Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-soccer the sweep web app (labels + logic driven by the new bootstrap
`competition` seam), consume `readOnly`/`wageringEnabled`, render/place the
`ml`/`ou`/`hcap` spine (killing the "+N more" drift), and stand up the
account-token web shell with the billing UI. Plan B (catalog/provision
self-serve) follows the go/no-go checkpoint.

**Architecture:** Spec is `docs/superpowers/specs/2026-07-04-phase6-frontend-reskin-design.md`
— read it first; the inventory `2026-07-04-p6-web-inventory.md` has per-file
line anchors. Three additive API seams (T1–T2), then web-only work: store
seams + fixture factory (T3), vocab (T4), emblem (T5), markets (T6),
hasDraws (T7), format/tabs (T8), relabel (T9), readOnly/wagering gates (T10),
account shell (T11), billing UI (T12), ledger close-out + GO/NO-GO (T13).

**Tech Stack:** api: Node 22 ESM, Fastify 5, Drizzle/Postgres (testcontainers).
web: Vite + React 18, Vitest + RTL (jsdom). Browser checks: claude-in-chrome.

## Global Constraints

- **Inversion rule:** the API is the stable side. `cd api && npm test` stays green (412+) at every commit; API changes are ADDITIVE-ONLY (new fields; no renames/removals/route changes).
- **Wire frozen (decision b):** `/api/coins`, `/api/bet`, `/api/parlay`, market keys (`1x2`, `ou25`, `ml`, …), `coin_ledger` keep their names. Web-local renames (SPA route `/wagers`, labels) are free.
- **Both suites green at every commit.** The web count MOVES this phase — record the new bar in the task's commit message (`web: N tests`) and in the T13 ledger section. Hooks run full suites + build; never `--no-verify`.
- **TDD:** failing test → run → minimal code → run → commit. Conventional Commits; `git push origin main` after each task.
- Run web tests from repo root: `npm test -w web`; single file: `cd web && npx vitest run src/<file>`. Api from `api/`: `npm test` (Docker running).
- **PWA survival:** never rename `web/src/sw.js`, `web/pwa.config.js` keys, or `web/public/*` asset FILENAMES; never remove `self.__WB_MANIFEST` (sw.js:24). `npm run build` must stay green (hooks run it).
- **Never**: push to `upstream`, touch the shared `sweep` Postgres DB, run deploy targets. Stripe = TEST MODE. GA property/event renames are deploy-gate work — do NOT touch `lib/analytics.js` event names or the `G-6PZ0DXRS2D` default this phase.
- Visual tasks (T5, T8, T10, T12) end with a real-browser screenshot check (claude-in-chrome) against dev servers (`npm run dev:api` + `npm run dev:web`); dev DB is `sweep_platform` (verify `current_database()` before any manual SQL).
- No browser `alert()`/`confirm()` anywhere (blocks browser automation) — use inline two-tap confirms.

## File Structure

- `api/src/routes/bootstrap.js` — + `competition` field (T1)
- `api/src/serialize.js` — `serializeCompetitor` + `logo` (T2)
- `api/src/routes/standings.js` — stats passthrough + conference fallback + pct sort (T2)
- `web/test/factories.js` — NEW shared bootstrap/fixture factory (T3)
- `web/src/data.js`, `web/src/lib/assemble.js` — seams into SWEEP (T3)
- `web/src/lib/vocab.js` — NEW per-sport term table (T4)
- `web/src/components.jsx` — Flag→emblem-aware, CrowdPick, ProbBar chooser, StatusPill, nav defs, AppHeader brand (T5/T7/T8/T9/T10)
- `web/src/lib/betLabels.js` — RENDERABLE_MARKETS + ml/ou/hcap (T6)
- `web/src/screens-bet-detail.jsx`, `web/src/screens-coins.jsx`, `web/src/FloatingReactions.jsx` — market rendering + drift (T6), draw labels (T7), copy (T9)
- `web/src/social.js` — hasDraws-guarded result fallback (T7)
- `web/src/screens-bracket.jsx` — NEW: KnockoutsScreen/bracket extracted from screens-main (T8)
- `web/src/screens-main.jsx`, `web/src/screens-detail.jsx` — standings cols, prob chooser, draw-backer, matchday/squad gating (T7/T8)
- `web/src/App.jsx` — dynamic tabs, `/wagers` route, ReadOnlyBanner mount (T8/T9/T10)
- `web/src/coins.js` — readOnly/wageringEnabled guards in `canWager`/`placeBet`/`placeParlay` (T10)
- `web/src/lib/accountClient.js`, `web/src/AccountRoot.jsx`, `web/src/main.jsx` — account shell (T11), billing panel (T12)
- `web/src/styles.css` — emblem variant, ro-banner, account/billing styles (T5/T10/T11/T12)
- `.superpowers/sdd/progress.md` — P6a section (T13)

---

### Task 1: api — bootstrap `competition` seam

**Files:**
- Modify: `api/src/routes/bootstrap.js`
- Test: the file asserting bootstrap fields today — find with `grep -rln "wageringEnabled" api/test` (extend that file; do not create a parallel one)

**Interfaces:**
- Produces: `GET /api/bootstrap` response gains
  `competition: { sport: string, hasDraws: boolean, name: string, season: string, format: 'league'|'groups_then_ko'|'knockout', logo: string|null }`.
  Consumed by web T3.

- [ ] **Step 1: Write the failing test** (in the located bootstrap test file, after the existing `wageringEnabled` assertion; reuse that test's app/sweep setup)

```js
it('serves the competition identity (sport, hasDraws, format)', async () => {
  const res = await inject('GET', '/api/bootstrap') // reuse the file's member-auth helper
  expect(res.statusCode).toBe(200)
  const { competition } = res.json()
  expect(competition).toMatchObject({
    sport: 'football', hasDraws: true, format: expect.any(String),
    name: expect.any(String), season: expect.any(String),
  })
  expect(competition).toHaveProperty('logo')
})
```

- [ ] **Step 2: Run it** — `cd api && npx vitest run test/<located-file>` → FAIL (competition undefined)

- [ ] **Step 3: Implement** in `api/src/routes/bootstrap.js`:

```js
import { eq } from 'drizzle-orm'
import { competitor, person, ownership, competition } from '../db/schema.js'
import { sportConfig } from '../sports.js'
```

Add a fifth query to the existing `Promise.all`:

```js
      app.db.select().from(competition).where(eq(competition.id, req.sweep.competitionId)).then((r) => r[0]),
```

(destructure as `comp`), and add to the returned object (after `wageringEnabled`):

```js
      competition: comp ? {
        sport: comp.sport, hasDraws: sportConfig(comp.sport).hasDraws,
        name: comp.name, season: comp.season, format: comp.format, logo: comp.logo ?? null,
      } : null,
```

- [ ] **Step 4: Run the file, then the full api suite** — both green. Note the new api count.
- [ ] **Step 5: Commit** — `feat(api): bootstrap serves competition {sport,hasDraws,name,season,format,logo}` — and push.

---

### Task 2: api — competitor `logo` + sport-usable standings

**Files:**
- Modify: `api/src/serialize.js` (serializeCompetitor), `api/src/routes/standings.js`
- Test: the files covering serializeCompetitor/standings today — find with `grep -rln "serializeCompetitor\|/api/standings" api/test`

**Interfaces:**
- Produces: bootstrap `teams[].logo` (string|null); `/api/standings` rows gain `pct/pf/pa` (number|null) and NBA groups key by conference; NBA sort by `pct`. Consumed by web T3/T5/T8.

- [ ] **Step 1: Failing tests.** (a) competitor serializer:

```js
it('serializeCompetitor carries logo', () => {
  expect(serializeCompetitor({ code: 'lal', name: 'Lakers', color: '#552583', logo: 'https://x/l.png', meta: { conference: 'Western Conference' } }).logo)
    .toBe('https://x/l.png')
})
```

(b) standings — in the standings route test file, insert a basketball competition + competitors with `meta: {conference: 'Eastern Conference'}` and `ranking` rows carrying `stats: {played: 2, win: 2, loss: 0, pf: 240, pa: 200, pct: 1.0}` / a second team `{..., win: 0, loss: 2, pct: 0}` (follow the file's existing insert helpers), then:

```js
const tables = res.json()
expect(Object.keys(tables)).toContain('Eastern Conference')
const rows = tables['Eastern Conference']
expect(rows[0]).toMatchObject({ pct: 1, pf: 240, pa: 200 })  // pct sorts first despite pts=0
expect(rows[0].win).toBe(2)
```

- [ ] **Step 2: Run both files** → FAIL.
- [ ] **Step 3: Implement.** `serialize.js`:

```js
  return { code: c.code, name: c.name, group: m.group ?? null, pool: m.pool ?? null, color: c.color, logo: c.logo ?? null, strength: m.strength ?? null, squad: m.squad ?? null }
```

`standings.js` — three line edits: group key `(tables[t.meta?.group ?? t.meta?.conference ?? ''] ??= [])`; row gains `pct: s.pct ?? null, pf: s.pf ?? null, pa: s.pa ?? null` (after `pts`); sort comparator becomes

```js
      tables[g].sort((x, y) => y.pts - x.pts || (y.pct ?? 0) - (x.pct ?? 0) || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name))
```

- [ ] **Step 4: Full api suite green** (football standings snapshots unchanged: pct null → 0 both sides).
- [ ] **Step 5: Commit** — `feat(api): competitor logo + standings pct/pf/pa passthrough, conference grouping` — push.

---

### Task 3: web — shared fixture factory + store seams

**Files:**
- Create: `web/test/factories.js`
- Modify: `web/src/data.js`, `web/src/lib/assemble.js`
- Test: `web/src/lib/assemble.test.js`, `web/src/data.test.js`

**Interfaces:**
- Produces: `makeBootstrap({sport})`, `makeFixture(over)`, `makeApi({sport, fixtures, standings})` for all later web tests; store fields `S.competition` ({sport,hasDraws,name,season,format,logo}), `S.readOnly` (bool), `S.wageringEnabled` (bool); team rows gain `logo`, `pct`, `pf`, `pa`.

- [ ] **Step 1: Write the factory** — `web/test/factories.js`:

```js
/* Shared multi-sport API-bundle factory for web tests (assembleSweep input shape). */
const FOOT_COMP = { sport: 'football', hasDraws: true, name: 'World Cup 2026', season: '2026', format: 'groups_then_ko', logo: null }
const BBALL_COMP = { sport: 'basketball', hasDraws: false, name: 'NBA', season: '2023-2024', format: 'league', logo: 'https://x/nba.png' }

export function makeTeam(over = {}) {
  return { code: 'hr', name: 'Croatia', group: 'A', pool: null, color: '#f00', logo: null, strength: 80, squad: null, ...over }
}
export function makeFixture(over = {}) {
  return { id: 'f1', group: 'A', matchday: 1, t1: 'hr', t2: 'br', ko: '2026-06-13T06:00:00.000Z',
    venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, phase: null,
    prob: { a: 45, d: 25, b: 30 }, markets: null, htScore: null, penScore: null,
    lineups: null, events: [], statistics: null, stage: 'group', derby: false, doubleOwner: false, winnerCode: null, ...over }
}
export function makeBootstrap(over = {}) {
  const { sport = 'football', ...rest } = over
  const bball = sport === 'basketball'
  return {
    teams: bball
      ? [makeTeam({ code: 'lal', name: 'Lakers', group: null, color: '#552583', logo: 'https://x/lal.png', strength: null }),
         makeTeam({ code: 'bos', name: 'Celtics', group: null, color: '#007a33', logo: 'https://x/bos.png', strength: null })]
      : [makeTeam(), makeTeam({ code: 'br', name: 'Brazil', group: 'A', color: '#ff0' })],
    people: [{ id: 'p1', name: 'Ann', short: 'Ann', initials: 'A', av: '#333', avatarPath: null, adult: true, excluded: false, createdAt: null }],
    ownership: { p1: bball ? ['lal'] : ['hr'] },
    scoring: { rule: 'top3', coOwners: false },
    sweep: { id: 's1', name: 'Test Sweep', role: 'member' },
    readOnly: false, wageringEnabled: true,
    competition: bball ? BBALL_COMP : FOOT_COMP,
    ...rest,
  }
}
export function makeApi(over = {}) {
  const { sport = 'football', fixtures, standings, bootstrap, ...rest } = over
  const bball = sport === 'basketball'
  return {
    bootstrap: bootstrap ?? makeBootstrap({ sport }),
    fixtures: fixtures ?? [bball ? makeFixture({ t1: 'lal', t2: 'bos', group: '', matchday: 0 }) : makeFixture()],
    standings: standings ?? (bball
      ? { 'Eastern Conference': [{ code: 'bos', name: 'Celtics', played: 2, win: 2, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0, pct: 1, pf: 240, pa: 200 }],
          'Western Conference': [{ code: 'lal', name: 'Lakers', played: 2, win: 1, draw: 0, loss: 1, gf: 0, ga: 0, gd: 0, pts: 0, pct: 0.5, pf: 220, pa: 221 }] }
      : { A: [{ code: 'hr', name: 'Croatia', played: 1, win: 1, draw: 0, loss: 0, gf: 2, ga: 0, gd: 2, pts: 3, pct: null, pf: null, pa: null }] }),
    photos: [], syncStatus: {},
    ...rest,
  }
}
```

- [ ] **Step 2: Failing tests** — append to `web/src/lib/assemble.test.js`:

```js
import { makeApi } from '../../test/factories.js'

it('threads competition/readOnly/wageringEnabled into the sweep object', () => {
  const s = assembleSweep(makeApi({ sport: 'basketball', bootstrap: makeBootstrap({ sport: 'basketball', readOnly: true, wageringEnabled: false }) }))
  expect(s.competition).toMatchObject({ sport: 'basketball', hasDraws: false, format: 'league' })
  expect(s.readOnly).toBe(true)
  expect(s.wageringEnabled).toBe(false)
  expect(s.teams.lal.logo).toBe('https://x/lal.png')
  expect(s.teams.lal.pct).toBeNull() // pct rides on standings rows
})
it('defaults the seams when bootstrap predates them', () => {
  const api = makeApi(); delete api.bootstrap.competition; delete api.bootstrap.readOnly; delete api.bootstrap.wageringEnabled
  const s = assembleSweep(api)
  expect(s.competition.hasDraws).toBe(true)   // football-shaped default
  expect(s.readOnly).toBe(false)
  expect(s.wageringEnabled).toBe(true)
})
it('teams carry standings pct/pf/pa when the rows have them', () => {
  const s = assembleSweep(makeApi({ sport: 'basketball' }))
  expect(s.teams.bos).toMatchObject({ pct: 1, pf: 240, pa: 200 })
})
```

and to `web/src/data.test.js`:

```js
it('setSweepData carries competition/readOnly/wageringEnabled onto SWEEP', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball', bootstrap: makeBootstrap({ sport: 'basketball', readOnly: true }) })))
  expect(SWEEP.competition.sport).toBe('basketball')
  expect(SWEEP.readOnly).toBe(true)
})
```

- [ ] **Step 3: Run** `cd web && npx vitest run src/lib/assemble.test.js src/data.test.js` → FAIL.
- [ ] **Step 4: Implement.** `data.js`: extend `emptySweep()` with

```js
    competition: { sport: 'football', hasDraws: true, name: '', season: '', format: 'groups_then_ko', logo: null },
    readOnly: false, wageringEnabled: true,
```

and `DATA_KEYS` gains `'competition', 'readOnly', 'wageringEnabled'`.
`assemble.js`: in the `teams[t.code]` literal add `logo: t.logo ?? null, pct: s.pct ?? null, pf: s.pf ?? null, pa: s.pa ?? null`; in the return add

```js
    competition: bootstrap.competition ?? { sport: 'football', hasDraws: true, name: '', season: '', format: 'groups_then_ko', logo: null },
    readOnly: bootstrap.readOnly === true,
    wageringEnabled: bootstrap.wageringEnabled !== false,
```

- [ ] **Step 5: Full web suite** `npm test -w web` → green. Record the new count.
- [ ] **Step 6: Commit** — `feat(web): consume bootstrap competition/readOnly/wageringEnabled; shared multi-sport test factory` — push.

---

### Task 4: web — sport vocab layer

**Files:**
- Create: `web/src/lib/vocab.js`
- Modify: `web/src/lib/assemble.js`, `web/src/data.js` (one key)
- Test: create `web/src/lib/vocab.test.js`

**Interfaces:**
- Produces: `vocabFor(sport)` → `{ noun, nounPlural, groupLabel, finalLabel, ftShort, koTabLabel, teamsIcon, standingsCols, live(f) }`; attached as `S.vocab` by assemble. `standingsCols` is `[ [rowKey, header], … ]`.

- [ ] **Step 1: Failing test** `web/src/lib/vocab.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { vocabFor } from './vocab.js'

describe('vocabFor', () => {
  it('football keeps soccer terms', () => {
    const v = vocabFor('football')
    expect(v.noun).toBe('match'); expect(v.finalLabel).toBe('Full time'); expect(v.ftShort).toBe('FT')
    expect(v.standingsCols.map(([k]) => k)).toEqual(['played', 'win', 'draw', 'loss', 'gf', 'ga', 'pts'])
    expect(v.live({ phase: 'HT', minute: 45 })).toBe('HT')
  })
  it('basketball is 2-way and quarter-based', () => {
    const v = vocabFor('basketball')
    expect(v.noun).toBe('game'); expect(v.finalLabel).toBe('Final'); expect(v.koTabLabel).toBe('Playoffs')
    expect(v.standingsCols.map(([k]) => k)).toEqual(['played', 'win', 'loss', 'pct', 'pf', 'pa'])
    expect(v.live({ phase: 'Q3', minute: null })).toBe('Q3')
    expect(v.live({ phase: null, minute: null })).toBe('')
  })
  it('unknown sport falls back to generic 2-way', () => {
    expect(vocabFor('handegg').noun).toBe('game')
  })
})
```

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** `web/src/lib/vocab.js`:

```js
import { liveLabel } from './format.js'

/* Per-sport UI vocabulary. Anything not listed here must key off wire facts
   (hasDraws/format), not off sport names. */
const GENERIC = {
  noun: 'game', nounPlural: 'games', groupLabel: 'Group', finalLabel: 'Final', ftShort: 'Final',
  koTabLabel: 'Playoffs', teamsIcon: 'shield',
  standingsCols: [['played', 'P'], ['win', 'W'], ['loss', 'L'], ['pct', 'PCT'], ['pf', 'PF'], ['pa', 'PA']],
  live: (f) => f.phase || '',
}
const SPORT_VOCAB = {
  football: {
    ...GENERIC,
    noun: 'match', nounPlural: 'matches', finalLabel: 'Full time', ftShort: 'FT',
    koTabLabel: 'Knockouts', teamsIcon: 'ball',
    standingsCols: [['played', 'P'], ['win', 'W'], ['draw', 'D'], ['loss', 'L'], ['gf', 'GF'], ['ga', 'GA'], ['pts', 'PTS']],
    live: liveLabel,
  },
  basketball: GENERIC,
}
export function vocabFor(sport) { return SPORT_VOCAB[sport] || GENERIC }
```

- [ ] **Step 4: Wire it** — assemble.js: `import { vocabFor } from './vocab.js'`; the return adds `vocab: vocabFor((bootstrap.competition ?? {}).sport || 'football')`. data.js `DATA_KEYS` gains `'vocab'`; `emptySweep()` gains `vocab: vocabFor('football')` (import at top). Assemble test: `expect(assembleSweep(makeApi({sport:'basketball'})).vocab.noun).toBe('game')`.
- [ ] **Step 5: Suites green; commit** — `feat(web): sport vocab layer (vocabFor) attached to SWEEP` — push.

---

### Task 5: web — emblem-aware team identity

**Files:**
- Modify: `web/src/components.jsx` (Flag component ~:132), `web/src/lib/assemble.js` (+`emblemSrc`), `web/src/data.js` (helper binding), `web/src/styles.css`
- Modify (call sites using raw `<img src={S.flag(...)}>`): `web/src/screens-coins.jsx`, `web/src/screens-bet-detail.jsx`, `web/src/FloatingReactions.jsx`, `web/src/SweepDraw.jsx`, `web/src/screens-main.jsx`, `web/src/screens-detail.jsx`
- Test: `web/src/components.test.jsx` (+ factory), new assertions in `web/src/lib/assemble.test.js`

**Interfaces:**
- Produces: `S.emblemSrc(code, size)` → url string | null (logo > football flag > null); `<Flag code .../>` unchanged signature, renders logo img / flag img / colored monogram `<span class="emblem-mono">` with team initials. All later tasks use Flag or S.emblemSrc — never S.flag directly in JSX.

- [ ] **Step 1: Failing tests** (components.test.jsx, using `makeApi`/`setSweepData` from the factory):

```js
it('Flag renders the club logo when the team has one', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))
  render(<Flag code="lal" w={24} h={24} />)
  expect(screen.getByRole('img').src).toBe('https://x/lal.png')
})
it('Flag falls back to a colored monogram when no logo and not football', () => {
  const api = makeApi({ sport: 'basketball' })
  api.bootstrap.teams[0].logo = null
  setSweepData(assembleSweep(api))
  const { container } = render(<Flag code="lal" w={24} h={24} />)
  expect(container.querySelector('.emblem-mono')).toBeTruthy()
  expect(container.querySelector('.emblem-mono').textContent).toBe('LA')
})
it('Flag keeps flagcdn for football teams', () => {
  setSweepData(assembleSweep(makeApi()))
  render(<Flag code="hr" w={24} h={17} />)
  expect(screen.getByRole('img').src).toContain('flagcdn.com')
})
```

assemble.test.js: `expect(s.emblemSrc('lal', 160)).toBe('https://x/lal.png')` (basketball) and `expect(s.emblemSrc('hr', 40)).toContain('flagcdn')` (football).

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** assemble.js (near `team`):

```js
  const isFootball = (bootstrap.competition ?? { sport: 'football' }).sport === 'football'
  const emblemSrc = (code, size) => {
    const t = teams[code]
    if (t?.logo) return t.logo
    if (isFootball) return flag(code, size)
    return null
  }
```

added to the return; data.js: `SWEEP.emblemSrc = assembled.emblemSrc` in `setSweepData` + a `() => null`-safe default in `emptySweep()` (`emblemSrc: (code, size) => flag(code, size)` keeps pre-load behavior). components.jsx Flag becomes:

```jsx
export function Flag({ code, w, h, cls }) {
  const src = S.emblemSrc ? S.emblemSrc(code, Math.max(w || 0, 80)) : S.flag(code, 80)
  if (src) {
    const logo = S.team(code)?.logo
    return <img className={(cls ? cls + ' ' : '') + (logo ? 'emblem' : 'flag')} src={src} width={w} height={h} alt="" loading="lazy" />
  }
  const t = S.team(code)
  const mono = (t?.name || code || '?').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
  return <span className="emblem-mono" style={{ width: w, height: h, background: t?.color || '#5b6f8e' }}>{mono}</span>
}
```

(match the existing Flag's current props/usage exactly — read it first; keep any existing className contract). styles.css adds:

```css
/* square club emblems (logo or monogram) alongside the 3:2 flag boxes */
img.emblem { object-fit: contain; border-radius: 4px; background: #fff2; }
.emblem-mono { display: inline-flex; align-items: center; justify-content: center;
  border-radius: 4px; color: #fff; font-weight: 700; font-size: 10px; letter-spacing: .5px; }
```

- [ ] **Step 4: Sweep the raw call sites** — every `<img … src={S.flag(x, n)} …>` in the six listed screen files becomes `<Flag code={x} …/>` where it renders a team, EXCEPT background watermarks (`coin-sel-bg`): those become `{(() => { const u = S.emblemSrc(x, 160); return u ? <img className="coin-sel-bg" src={u} alt=""/> : null })()}`. `S.flag` itself stays exported (format.js untouched) — tests and football paths still use it.
- [ ] **Step 5: Full web suite** — update any test asserting `img.flag` where the fixture is now basketball; football fixtures must stay byte-identical. Record count.
- [ ] **Step 6: Browser check** — with dev servers up, open the WC sweep (default host) in Chrome via claude-in-chrome; screenshot Home; flags must render exactly as before.
- [ ] **Step 7: Commit** — `feat(web): emblem-aware team identity (logo > flag > monogram)` — push.

---

### Task 6: web — ml/ou/hcap rendering + the "+N more" drift fix

**Files:**
- Modify: `web/src/lib/betLabels.js`, `web/src/screens-bet-detail.jsx` (:14-16, :80), `web/src/screens-coins.jsx` (:671, :744, :786), `web/src/FloatingReactions.jsx` (:86-102)
- Test: `web/src/screens-bet-detail.test.jsx`, `web/src/screens-coins.test.jsx`, new `web/src/lib/betLabels.test.js`

**Interfaces:**
- Produces: `RENDERABLE_MARKETS` (ordered array) and extended `MARKET_LABELS`/`betSelectionLabel` from betLabels.js. screens-coins exports nothing new; drift invariant: "+N" counts only keys in RENDERABLE_MARKETS.

- [ ] **Step 1: Failing tests.** `web/src/lib/betLabels.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { RENDERABLE_MARKETS, MARKET_LABELS, betSelectionLabel } from './betLabels.js'
import { setSweepData } from '../data.js'
import { assembleSweep } from './assemble.js'
import { makeApi, makeFixture } from '../../test/factories.js'

const NBA_MARKETS = {
  ml: { label: 'Moneyline', book: 'B', selections: [{ key: 'HOME', label: 'Home', odds: 1.6 }, { key: 'AWAY', label: 'Away', odds: 2.3 }] },
  ou: { label: 'Total Points', line: 220.5, book: 'B', selections: [{ key: 'OVER', label: 'Over', odds: 1.9 }, { key: 'UNDER', label: 'Under', odds: 1.9 }] },
  hcap: { label: 'Handicap', line: -4.5, book: 'B', selections: [{ key: 'HOME', label: 'Home', odds: 1.9 }, { key: 'AWAY', label: 'Away', odds: 1.9 }] },
}
beforeEach(() => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball',
    fixtures: [makeFixture({ id: 'g1', t1: 'lal', t2: 'bos', group: '', matchday: 0, markets: NBA_MARKETS })] })))
})
it('labels the generic spine', () => {
  expect(MARKET_LABELS.ml).toBe('Moneyline'); expect(MARKET_LABELS.ou).toBe('Over/Under'); expect(MARKET_LABELS.hcap).toBe('Handicap')
  expect(RENDERABLE_MARKETS).toEqual(expect.arrayContaining(['ml', 'ou', 'hcap', '1x2', 'toq', 'ou25']))
})
it('selection wording: team names, O/U line, signed handicap', () => {
  expect(betSelectionLabel({ market: 'ml', selection: 'HOME', fixtureId: 'g1' })).toBe('Lakers')
  expect(betSelectionLabel({ market: 'ou', selection: 'OVER', fixtureId: 'g1', line: 220.5 })).toBe('Over 220.5')
  expect(betSelectionLabel({ market: 'hcap', selection: 'HOME', fixtureId: 'g1', line: -4.5 })).toBe('Lakers -4.5')
  expect(betSelectionLabel({ market: 'hcap', selection: 'AWAY', fixtureId: 'g1', line: -4.5 })).toBe('Celtics +4.5')
})
```

screens-bet-detail.test.jsx: NBA fixture with NBA_MARKETS renders three market blocks (Moneyline first) and selection buttons show team names. screens-coins.test.jsx: (a) an ml-only NBA fixture APPEARS on the Wagers list with an ml headline; (b) drift regression — a football fixture with `{'1x2', ou25, hcap, zzz_unknown}` markets shows `+2 more markets` (hcap + ou25 count; `zzz_unknown` must NOT).

- [ ] **Step 2: Run the three files** → FAIL.
- [ ] **Step 3: Implement.** betLabels.js:

```js
// every market key the web can render, in display order (bet-detail + "+N more" both consume this)
export const RENDERABLE_MARKETS = ['toq', '1x2', 'ml', 'dc', 'ou25', 'ou', 'hcap', 'btts', 'oe', 'cards', 'fh1x2', 'fhou', 'cs', 'gs']
```

`MARKET_LABELS` gains `ml: 'Moneyline', ou: 'Over/Under', hcap: 'Handicap'`. `betSelectionLabel`: the team-name branch condition adds `|| b.market === 'ml'`; the OVER/UNDER branch adds `|| b.market === 'ou'`; new hcap branch before the fallback:

```js
  if (b.market === 'hcap' && f) {
    const line = b.line ?? f?.markets?.hcap?.line ?? 0
    const t = b.selection === 'HOME' ? S.team(f.t1)?.name || 'Home' : S.team(f.t2)?.name || 'Away'
    const n = b.selection === 'HOME' ? line : -line
    return `${t} ${n > 0 ? '+' : ''}${n}`
  }
```

screens-bet-detail.jsx: delete the local `MARKET_ORDER`, `import { RENDERABLE_MARKETS } … from './lib/betLabels.js'`, `const keys = RENDERABLE_MARKETS.filter((k) => markets[k])`; `TEAM_MARKETS` gains `'ml', 'hcap'`; `selLabel` gains the hcap signed-line wording (same formula as betLabels). screens-coins.jsx: `:671` filter → `['toq', '1x2', 'ml'].some((k) => f.markets?.[k])`; `:744` → `const mktKey = f.markets.toq ? 'toq' : f.markets['1x2'] ? '1x2' : 'ml'`; `:786` count → `Object.keys(f.markets).filter((k) => RENDERABLE_MARKETS.includes(k)).length - 1` (import RENDERABLE_MARKETS). FloatingReactions.jsx: delete `BET_MARKET_NAMES`, use `MARKET_LABELS[market] || 'Bet'`; extend `describeBet`'s team-selection branch to `['1x2','fh1x2','toq','ml','hcap']` and the O/U branch to `['ou25','cards','ou','fhou']` with `line ?? 2.5` becoming `line` when present.

- [ ] **Step 4: Full web suite green.** Record count.
- [ ] **Step 5: Commit** — `feat(web): render+place ml/ou/hcap; +N-more counts renderable markets only (drift fix)` — push.

---

### Task 7: web — hasDraws replaces stage-based draw logic

**Files:**
- Modify: `web/src/components.jsx` (CrowdPick :262, ProbBar call sites), `web/src/social.js` (:87, :114), `web/src/screens-detail.jsx` (prediction bar + draw-backer regions — grep `stage === "group"`), `web/src/screens-main.jsx` (hero prob chooser)
- Test: `web/src/components.test.jsx`, `web/src/social.test.js`, `web/src/screens-detail.test.jsx`

**Interfaces:**
- Consumes: `S.competition.hasDraws` (T3). Rule everywhere: `showDraw = S.competition.hasDraws && f.stage === 'group'`; two-way prob when `!hasDraws || stage === 'knockout'`.

- [ ] **Step 1: Failing tests.** components.test.jsx:

```js
it('CrowdPick shows no draw zone on a no-draw sport, even at stage=group', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))   // NBA regular season maps stage:'group'
  render(<CrowdPick f={SWEEP.fixtures[0]} locked={false} />)
  expect(screen.queryByText('Draw')).toBeNull()
  expect(screen.getByText(/Tap a team to call the winner/)).toBeTruthy()
})
it('CrowdPick keeps the draw zone on football group games', () => {
  setSweepData(assembleSweep(makeApi()))
  render(<CrowdPick f={SWEEP.fixtures[0]} locked={false} />)
  expect(screen.getByText('Draw')).toBeTruthy()
})
```

social.test.js: a tied NBA final without winnerCode credits NO pick (`predictionLeaderboard` gives correct 0 for a DRAW picker); football keeps the current DRAW-credit test unchanged.

- [ ] **Step 2: Run** → FAIL (draw zone renders for basketball).
- [ ] **Step 3: Implement.** components.jsx `:262`: `const showDraw = S.competition.hasDraws && f.stage === "group";`. social.js: both `const result = f.winnerCode || (a > b ? f.t1 : b > a ? f.t2 : DRAW)` occurrences (:87, :114) become `… : (S.competition.hasDraws ? DRAW : null))`. Grep `web/src` for every remaining `stage === "group"` / `stage === 'group'` that gates DRAW UI or 3-way probability (screens-detail prediction bar, draw-backer; screens-main hero ProbBar chooser) and apply the same two rules; leave stage checks that are genuinely about knockout structure (elimination logic in assemble) alone.
- [ ] **Step 4: Full web suite; update class-b tests** whose football expectations still hold (they must not change) and add basketball variants where the file already has the factory. Record count.
- [ ] **Step 5: Commit** — `feat(web): draw UI and 3-way probs keyed on hasDraws, not stage` — push.

---

### Task 8: web — format-driven tabs, bracket extraction, standings columns

**Files:**
- Create: `web/src/screens-bracket.jsx` (KnockoutsScreen + BracketView + R32_DEFS moved verbatim from screens-main.jsx)
- Modify: `web/src/App.jsx` (:29 TABS → tabsFor(), imports), `web/src/components.jsx` (BottomNav/Sidebar defs :524/:579), `web/src/screens-main.jsx` (StandingsScreen columns + openKnockouts gating + scorer/cards data-gating), `web/src/screens-detail.jsx` (TeamsScreen PTS column, matchday label hide when falsy)
- Test: `web/src/App.test.jsx`, `web/src/components.test.jsx`, `web/src/screens-main` coverage lives in components/screens tests — put StandingsScreen column tests in `web/src/screens-main.test.jsx` (new file)

**Interfaces:**
- Produces: `tabsFor()` exported from App.jsx → ordered tab ids; `KnockoutsScreen` now imported from `./screens-bracket.jsx`. Consumes `S.competition.format`, `S.vocab.{koTabLabel, teamsIcon, standingsCols, noun}`.

- [ ] **Step 1: Failing tests.** App.test.jsx:

```js
it('league competitions have no knockouts tab or route', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))
  expect(tabsFor()).not.toContain('knockouts')
  expect(readView('/knockouts').tab).toBe('home')   // route falls back
})
it('cup competitions keep knockouts', () => {
  setSweepData(assembleSweep(makeApi()))
  expect(tabsFor()).toContain('knockouts')
})
```

screens-main.test.jsx (new): StandingsScreen for basketball renders headers `W L PCT PF PA` and a `Eastern Conference` heading; for football renders `GF GA PTS` and `Group A`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - Move KnockoutsScreen/BracketView/R32_DEFS (and their private helpers ONLY — `git log` nothing, pure cut/paste) into `web/src/screens-bracket.jsx`; screens-main.jsx re-imports nothing from it; App.jsx imports `KnockoutsScreen` from `./screens-bracket.jsx`.
  - App.jsx: replace the TABS const with

```js
export function tabsFor() {
  const t = ["schedule", "people", "teams"];
  if (S.competition?.format !== "league") t.push("knockouts");
  t.push("standings");
  if (S.wageringEnabled !== false) t.push("coins");
  return t;
}
```

  `readView` last line uses `tabsFor().includes(seg[0])`; the `seg[0] === "knockouts"` branch also requires `S.competition?.format !== "league"`. (The wageringEnabled clause lands here but is TESTED in T10 — keep it, T10 asserts it.)
  - components.jsx BottomNav/Sidebar: build their item arrays from `tabsFor()` mapping id → label/icon, with `knockouts` label = `S.vocab.koTabLabel` and the teams icon = `S.vocab.teamsIcon === 'ball' ? Icon.ball : Icon.shield` (add a simple `Icon.shield` SVG if none exists).
  - screens-main StandingsScreen: header + row cells map over `S.vocab.standingsCols` (`pct` renders as `.500`-style: `t.pct != null ? t.pct.toFixed(3).replace(/^0/, '') : '–'`); group headings render the standings key verbatim; the "View knockout bracket" link renders only when `S.competition.format !== 'league'`.
  - Scorer/goal/card summaries (screens-main Home) and SquadList/Starting-XI (screens-detail): render only when the data is non-empty (they already read `f.events`/`squad` — verify each returns null on empty and add the guard where it doesn't). Matchday chip: render only when `f.matchday` is truthy.
- [ ] **Step 4: Full web suite; fix routed tests.** Record count.
- [ ] **Step 5: Browser check** — Chrome: WC sweep still shows Knockouts tab + bracket; screenshot. (NBA check lands in T13's live pass — the NBA sweep needs the account host flow.)
- [ ] **Step 6: Commit** — `feat(web): format-driven tabs + bracket module; per-sport standings columns` — push.

---

### Task 9: web — relabel pass (brand, copy, /wagers route)

**Files:**
- Modify: `web/index.html` (:15), `web/public/site.webmanifest` (:2), `web/src/SweepProvider.jsx` (GateBrand :31), `web/src/components.jsx` (AppHeader :417, Sidebar :593, MatchCard footer :374, StatusPill :227-228), `web/src/App.jsx` (urlFor/readView `/wagers`), `web/src/screens-coins.jsx` (WAGERS_END :574/:610, copy :614-615/:725/:737), `web/src/lib/format.js` (whenLabel FT suffix), `web/src/screens-statement.jsx` (reward wording)
- Test: `web/test/index-html.test.js`, `web/src/App.test.jsx`, `web/src/components.test.jsx`, `web/src/screens-coins.test.jsx`

**Interfaces:**
- Consumes `S.vocab.{noun, nounPlural, groupLabel, finalLabel, ftShort}`, `S.competition.name`. No new exports.

- [ ] **Step 1: Failing tests:** index-html test expects title `The Sweep`; App.test expects `urlFor({tab:'coins'})` → `/wagers` and `readView('/wagers').tab` → `'coins'`; components.test expects the home header small-print to show the competition name (`World Cup 2026` from the factory) and StatusPill to read `Final` for basketball finals / `Full time` for football.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - index.html title + manifest name → `The Sweep`. Theme color stays (decision d).
  - GateBrand: `<small>WORLD CUP 2026</small>` → delete the `<small>` line (Gate renders pre-bootstrap; no competition data exists yet).
  - AppHeader/Sidebar brand small-print → `{S.competition?.name ? S.competition.name.toUpperCase() : ""}`.
  - MatchCard footer → `{f.group ? <span className="grp">{S.vocab.groupLabel.toUpperCase()} {f.group}</span> : null}`.
  - StatusPill final → `{S.vocab.finalLabel}`; live → `Live · {S.vocab.live(f)}` pattern (keep the current conditional structure). format.js `whenLabel` FT suffix → callers pass through — change `'· FT'` to use vocab at the call sites that show it, or simplest: `whenLabel(f, ftShort = 'FT')` with screens passing `S.vocab.ftShort` (keep default so existing tests hold).
  - App.jsx urlFor: `return v.tab === "home" ? "/" : v.tab === "coins" ? "/wagers" : \`/\${v.tab}\`;` readView: map seg `wagers` → tab `coins` (wire key stays `coins` internally).
  - screens-coins: delete `WAGERS_END`; the info-sheet grant line ends `— each week while the season runs.`; `match outcome` → `${S.vocab.noun} outcome`; `team you own wins a match` → `wins a ${S.vocab.noun}`; `No bettable matches right now.` → `` `No bettable ${S.vocab.nounPlural} right now.` ``; daydiv count uses nounPlural/noun.
  - screens-statement: `Your team won` line → `` `Your team won a ${S.vocab.noun}` `` (match the file's existing string shape).
- [ ] **Step 4: Full suites green** (this touches many pinned strings — update the football assertions ONLY where the string legitimately changed, e.g. title). Record count.
- [ ] **Step 5: Commit** — `feat(web): sport-neutral copy, competition-name branding, /wagers route` — push.

---

### Task 10: web — readOnly banner + wageringEnabled gating

**Files:**
- Modify: `web/src/App.jsx` (banner mount; coins tab already gated by tabsFor), `web/src/coins.js` (canWager/placeBet/placeParlay guards), `web/src/components.jsx` (CrowdPick lock, ReadOnlyBanner component), `web/src/screens-detail.jsx` (UploadSheet read-only state), `web/src/SweepDraw.jsx` (run-draw disable), `web/src/styles.css` (.ro-banner)
- Test: `web/src/App.test.jsx`, `web/src/components.test.jsx`, `web/src/coins.test.js`

**Interfaces:**
- Consumes `S.readOnly`, `S.wageringEnabled`. Produces `ReadOnlyBanner` (components.jsx export).

- [ ] **Step 1: Failing tests.** App.test: with `wageringEnabled:false` bootstrap, `tabsFor()` has no `coins` and `readView('/wagers').tab` is `'home'`; with `readOnly:true`, rendering App shows text `read-only`. coins.test: `canWager()` false when `SWEEP.wageringEnabled === false` even for an adult identity; `placeBet` on a readOnly sweep does not call postBet (mock) and leaves balance unchanged. components.test: CrowdPick with `readOnly:true` sweep renders locked (`Closed`) even for an upcoming fixture.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - components.jsx:

```jsx
/* Lapsed-subscription banner — bootstrap.readOnly is the single source of truth. */
export function ReadOnlyBanner() {
  if (!S.readOnly) return null
  return <div className="ro-banner" role="status">This sweep is read-only — the owner’s subscription has lapsed. You can still browse everything.</div>
}
```

  App.jsx renders `<ReadOnlyBanner/>` immediately above `{base}` in BOTH the desktop and mobile returns. styles.css: `.ro-banner { background:#7a4a00; color:#ffe2b0; text-align:center; font-size:12.5px; padding:6px 12px; }`
  - coins.js: `canWager()` → `return !!me && me.adult !== false && !isOptedOut() && S.wageringEnabled !== false`; first line of `placeBet` and `placeParlay` bodies (after `me` check): `if (S.readOnly) { toast('Sweep is read-only'); return { ok: false } }` (placeBet returns nothing today — plain `return` there).
  - CrowdPick: `locked` becomes `locked || S.readOnly` at the top of the component (one line, all call sites covered).
  - UploadSheet: when `S.readOnly`, render the sheet body as a single muted line `Uploads are paused while the sweep is read-only.` instead of the form. SweepDraw: the Run-sweep button gets `disabled={S.readOnly}`.
- [ ] **Step 4: Full suites; record count.**
- [ ] **Step 5: Browser check** — flip the dev NBA sweep's owning account to lapsed IF quick via existing test helpers; otherwise verify via a jsdom-rendered state only and defer the live lapsed check to T13 (it's in the live-pass list).
- [ ] **Step 6: Commit** — `feat(web): read-only banner + wagering-off tab/placement gating from bootstrap` — push.

---

### Task 11: web — account client + AccountRoot (sign-in / redeem)

**Files:**
- Create: `web/src/lib/accountClient.js`, `web/src/AccountRoot.jsx`
- Modify: `web/src/main.jsx` (mount `/account/*` like `/super`), `web/src/styles.css` (reuse `.sweep-gate`/`.sweep-card` classes — no new design)
- Test: create `web/src/lib/accountClient.test.js`, `web/src/AccountRoot.test.jsx`

**Interfaces:**
- Produces: `accountClient` exports — `getAccountToken()/setAccountToken(t)/clearAccountToken()` (localStorage key `sweep.account.token.v1`), `requestLogin(email)`, `redeemLogin(token)` (stores token, returns account), `getAccount()`, `getAccountSweeps()`, `archiveSweep(id)`, `getBilling()`, `startCheckout()`, `openPortal()` — each non-2xx throws `Object.assign(new Error(body.error||'HTTP '+status), { status, code: body.error })`. `AccountRoot` handles paths: `/account`, `/account/login/:token`, `/account/billing/success`, `/account/billing/cancelled`.

- [ ] **Step 1: Failing tests.** accountClient.test.js (mock `fetch`): requestLogin POSTs `/api/account/login` `{email}` without the token header; after `setAccountToken('t1')`, getBilling GETs `/api/account/billing` with header `x-account-token: t1`; a 402 response throws with `code === 'subscription_required'`; `redeemLogin('tok')` POSTs `/api/account/session` and persists the returned `accountToken`. AccountRoot.test.jsx: unauthenticated `/account` renders an email form; submitting calls requestLogin and shows `Check your email`; `/account/login/abc` calls redeemLogin and lands on the account home; a 401 redeem shows `link expired`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** accountClient.js:

```js
const KEY = 'sweep.account.token.v1'
export const getAccountToken = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const setAccountToken = (t) => { try { localStorage.setItem(KEY, t) } catch {} }
export const clearAccountToken = () => { try { localStorage.removeItem(KEY) } catch {} }

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json' }
  const tok = getAccountToken()
  if (tok) headers['x-account-token'] = tok
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, code: data?.error })
  return data
}
export const requestLogin = (email) => call('POST', '/api/account/login', { email })
export async function redeemLogin(token) {
  const out = await call('POST', '/api/account/session', { token })
  setAccountToken(out.accountToken)
  return out.account
}
export const getAccount = () => call('GET', '/api/account')
export const getAccountSweeps = () => call('GET', '/api/account/sweeps')
export const archiveSweep = (id) => call('POST', `/api/account/sweeps/${id}/archive`)
export const getBilling = () => call('GET', '/api/account/billing')
export const startCheckout = () => call('POST', '/api/account/billing/checkout')
export const openPortal = () => call('POST', '/api/account/billing/portal')
```

AccountRoot.jsx: tiny path-switch component (no router lib):

```jsx
import { useEffect, useState } from 'react'
import { requestLogin, redeemLogin, getAccount, getAccountToken, clearAccountToken } from './lib/accountClient.js'
import { AccountHome } from './screens-account.jsx' // T12 creates it; until then a placeholder in this file

export function AccountRoot() {
  const path = window.location.pathname
  if (path.startsWith('/account/login/')) return <Redeem token={path.split('/')[3]} />
  if (path === '/account/billing/success') return <Landing msg="Subscription active — thanks! Your sweeps stay live." />
  if (path === '/account/billing/cancelled') return <Landing msg="Checkout cancelled. Nothing was charged." />
  return <Entry />
}
```

with `Entry` (token? → AccountHome (T12 placeholder: `<p>Signed in.</p>` this task) after a `getAccount()` check that clears a stale token on 401 : sign-in email form → "Check your email — the sign-in link is valid for 15 minutes." with dev hint "(dev: the link is printed on the API console)"), `Redeem` (calls redeemLogin on mount → `window.location.replace('/account')`; on error shows "That sign-in link has expired or was already used." + link back), `Landing` (message + `<a href="/account">Back to my account</a>`). Reuse `.sweep-gate`/`.sweep-card` classes. main.jsx: before the existing super-route check, `if (window.location.pathname.startsWith('/account')) { root.render(<AccountRoot/>); registerSW(); }` — mirror exactly how the `/super` mount short-circuits (read main.jsx:16-24 first and follow its pattern, including StrictMode wrapper if present).

- [ ] **Step 4: Suites green; record count.**
- [ ] **Step 5: Commit** — `feat(web): account shell — header-token client, magic-link sign-in/redeem, billing landings` — push.

---

### Task 12: web — account home: my-sweeps + billing panel

**Files:**
- Create: `web/src/screens-account.jsx` (AccountHome, BillingPanel, SweepList)
- Modify: `web/src/AccountRoot.jsx` (drop the placeholder, import AccountHome), `web/src/styles.css`
- Test: create `web/src/screens-account.test.jsx`

**Interfaces:**
- Consumes accountClient (T11 signatures). BillingPanel state machine from `getBilling()`: fresh (`!subscribed && !trialEndsAt`), trialing (`!subscribed && trialEndsAt > now`), lapsed (`!subscribed && trialEndsAt <= now`), subscribed (`subscribed`; soft warning when `subscriptionStatus === 'past_due'`).

- [ ] **Step 1: Failing tests** (mock accountClient module with `vi.mock`):

```js
it('fresh account: explains the trial', async () => {
  getBilling.mockResolvedValue({ subscribed: false, subscriptionStatus: null, trialEndsAt: null, liveSweeps: 0, quantity: 0 })
  getAccountSweeps.mockResolvedValue([])
  render(<AccountHome />)
  expect(await screen.findByText(/14-day free trial starts with your first sweep/i)).toBeTruthy()
})
it('trialing: countdown + subscribe CTA calls checkout and redirects', async () => { /* trialEndsAt future; click Subscribe → startCheckout resolves {url} → window.location.assign called with it */ })
it('subscribed: shows live sweep count and Manage billing (portal)', async () => { /* subscribed:true, liveSweeps:2 → "2 live sweeps"; Manage billing → openPortal url redirect */ })
it('lapsed: subscribe CTA + read-only warning', async () => { /* trialEndsAt past → /read-only/i present */ })
it('sweep list renders links and archives with two-tap confirm', async () => {
  getAccountSweeps.mockResolvedValue([{ id: 'sw1', name: 'My NBA', competitionId: 'c1', archivedAt: null, createdAt: 'x', memberLink: 'https://h/g/m1', adminLink: 'https://h/admin/a1' }])
  /* click Archive → button text becomes "Really archive?"; second click → archiveSweep('sw1') */
})
it('archived sweeps are filtered out', async () => { /* archivedAt set → not rendered */ })
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** screens-account.jsx — AccountHome loads billing + sweeps in parallel on mount (plain `useEffect` + `useState`; no react-query here, the account shell stays outside SweepProvider); BillingPanel renders per the four states with `Subscribe` → `startCheckout().then(({url}) => window.location.assign(url)).catch(e => e.code === 'already_subscribed' ? openPortal().then(({url}) => window.location.assign(url)) : setErr(e))` and `Manage billing` → openPortal (409 `not_subscribed` → flip to checkout); SweepList shows non-archived sweeps, member/admin links as copyable `readOnly` inputs (the screens-super LinkField pattern — reuse it by exporting LinkField from screens-super.jsx), two-tap archive; a `Sign out` button (clearAccountToken + reload). Trial countdown: whole days via `Math.ceil((new Date(trialEndsAt) - Date.now()) / 86400000)`.
- [ ] **Step 4: Suites green; record count.**
- [ ] **Step 5: Browser check (the 4242 flow, Stripe TEST mode)** — dev servers up; in Chrome: `/account` → sign in as beerworker@gmail.com (link from API console) → account home shows the ACTIVE subscription state for the real test account → `Manage billing` opens the Stripe test Portal. Then with a THROWAWAY email: fresh state → provision is Plan-B so instead verify Subscribe → Checkout page loads (4242 payment only if a trial account with live sweeps exists — otherwise record "checkout page reached" and complete the 4242 run in T13's live pass). Screenshot each state.
- [ ] **Step 6: Commit** — `feat(web): account home — my-sweeps list + 4-state billing panel wired to Stripe endpoints` — push.

---

### Task 13: ledger close-out + GO/NO-GO checkpoint

**Files:**
- Modify: `.superpowers/sdd/progress.md` (P6a section), `docs/superpowers/specs/2026-07-04-phase6-frontend-reskin-design.md` (deviations + AFK-defaults status)

- [ ] **Step 1: Full verification** — `cd api && npm test` (412+ green), `npm test -w web` (new bar), `npm run build`.
- [ ] **Step 2: Live browser pass (claude-in-chrome, Stripe test mode):** WC sweep — full soccer function (bracket, groups, flags, coins incl. an hcap market visible in bet-detail once present); NBA sweep `sw_aX7u2IQSwCDR` via its member link — basketball-native (no groups/flags/matchday/goalscorer/cards, 2-way CrowdPick, Playoffs absent, conference standings); wagering OFF sweep (toggle via `POST /api/admin/wagering`) — no wagering UI; opt-out flow; lapsed read-only — banner + locked votes (lapse the throwaway account or flip subscriptionStatus in the dev DB — `sweep_platform` ONLY, verify `current_database()`); billing — fresh→checkout 4242→subscribed→portal. Screenshot each.
- [ ] **Step 3: Ledger** — append the P6a section to `.superpowers/sdd/progress.md` following the P1–P5 format: commit range, per-task review outcomes, api/web bars per task, **formal retirement of the web-436 invariant** (state the final P6a bar), AFK defaults standing for veto (decision a = both-with-checkpoint; GateBrand small-line removal; GA renames deferred to deploy gate).
- [ ] **Step 4: Commit** — `docs(p6a): SDD ledger P6a section + design close-out` — push.
- [ ] **Step 5: GO/NO-GO** — ask the owner: proceed to Plan B (catalog + provision + my-sweeps polish) in this phase, or cut to P7? AFK → proceed per the recorded default, veto standing.

---

## Self-Review (done at write time)

- **Spec coverage:** design §2→T1/T2; §3→T3/T4; §4→T5; §5→T7 (+T8 structure); §6→T6; §7→T9/T10; §8→T11/T12; §10 survival→global constraints (no task touches sw.js/pwa.config/asset names; analytics frozen); §11→factory in T3, per-task test evolution, no Playwright; §12/§13→T13. §9 (catalog/provision) is deliberately Plan B.
- **Placeholder scan:** T12 Step 1 uses comment-elided test bodies for brevity but each names its exact mock data and assertion; implementer writes them from that line. No TBDs.
- **Type consistency:** `S.competition.{sport,hasDraws,format,name}` (T3) consumed T4/T7/T8/T9; `vocabFor` shape (T4) consumed T8/T9; `RENDERABLE_MARKETS` (T6) consumed in bet-detail + coins count; `tabsFor()` (T8) consumed T10 tests; accountClient signatures (T11) consumed T12. Factory paths: tests in `web/src/lib/` import `../../test/factories.js`; tests in `web/src/` import `../test/factories.js`.
- **Known judgment calls:** Flag upgrade reuses the existing component contract (T5 reads it first); `whenLabel` keeps a defaulted param so old call sites/tests hold; readOnly write-guarding is done at the 4 single points (CrowdPick, coins.js, UploadSheet, SweepDraw) rather than per-button.
