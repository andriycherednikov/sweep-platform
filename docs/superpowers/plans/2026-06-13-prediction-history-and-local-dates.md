# Prediction History + Local Unified Date/Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-person prediction history (what they picked, when, and whether the call was right) to a profile, and render every date in the viewer's local timezone using one unified format `Sun, 14 June · 8:00 AM`.

**Architecture:** Pure frontend. All data already exists client-side: predictions live in the `support` map in `web/src/social.js`; the correctness rule already exists in `predictionLeaderboard`. Date formatting is centralized in `web/src/lib/format.js`; per-fixture labels are baked in `web/src/lib/assemble.js`. We remove the hardcoded `Australia/Sydney`, add a canonical `fmtDateTime` + a `whenLabel(f)` helper, swap every display site, then build the prediction-history helpers and the profile UI.

**Tech Stack:** Vite + React 18, Vitest + jsdom + @testing-library/react. Tests run from the `web/` workspace via `npx vitest run --root web`.

**Branch:** `feat/prediction-history` (already created off `main`).

**Conventions:**
- Run a single test file with: `npx vitest run --root web src/<path>.test.<ext>`
- Commits use Conventional Commits and end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- The repo has a pre-commit hook running the full web suite + build, so every `git commit` validates the whole project. `--no-verify` is blocked by a hook; never use it.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `web/test/setup.js` | Pin test TZ so date output is deterministic | Modify |
| `web/src/lib/format.js` | Canonical date/time formatters (local zone) | Modify |
| `web/src/lib/format.test.js` | Unit tests for formatters + `whenLabel` | Modify |
| `web/src/lib/assemble.js` | Bake `dateTimeLabel` onto each fixture | Modify |
| `web/src/data.js` | Re-export renamed `fmtDate` | Modify |
| `web/src/components.jsx` | MatchCard time + two "today" stamps | Modify |
| `web/src/components.test.jsx` | Test MatchCard one-line label | Modify |
| `web/src/screens-main.jsx` | Schedule subtitle (drop "Sydney time") | Modify |
| `web/src/screens-detail.jsx` | Match-sheet caption, gpk-meta, match rows, PersonDetail prediction history | Modify |
| `web/src/screens-detail.test.jsx` | Test row format + prediction history + accuracy tile | Modify |
| `web/src/social.js` | `predictionsOf` / `predictionAccuracy` helpers | Modify |
| `web/src/social.test.js` | Unit tests for the two helpers | Modify |
| `web/src/styles.css` | `.fx-when`, `.fx-main`, verdict pills, pick highlight | Modify |

---

## Task 1: Localize formatters + canonical `fmtDateTime` + `whenLabel`

**Files:**
- Modify: `web/test/setup.js`
- Modify: `web/src/lib/format.js`
- Modify: `web/src/lib/format.test.js`

- [ ] **Step 1: Pin the test timezone**

At the VERY TOP of `web/test/setup.js` (before the existing import), add:

```js
// Pin the timezone so date/time formatting is deterministic in CI regardless of
// the machine's local zone. Production uses the viewer's real local zone.
process.env.TZ = 'Australia/Sydney'

import '@testing-library/jest-dom/vitest'
```

(Keep the rest of the file unchanged.)

- [ ] **Step 2: Write the failing formatter tests**

Replace the timezone test in `web/src/lib/format.test.js` (the `'Sydney formatters are stable…'` test) and update the import line. New import line:

```js
import { flag, gd, fmtTime, fmtDate, fmtDateTime, fmtDayKey, fmtWeekday, whenLabel } from './format.js'
```

Replace the last test with:

```js
test('formatters are stable for a known instant (TZ pinned to Sydney in setup)', () => {
  const d = new Date('2026-06-13T06:30:00Z') // 16:30 Sydney (UTC+10)
  expect(fmtDayKey(d)).toBe('2026-06-13')
  expect(fmtWeekday(d)).toBe('Saturday')
  expect(fmtDate(d)).toBe('Sat, 13 June')        // weekday short · day · FULL month
  expect(fmtTime(d)).toBe('4:30 PM')
  expect(fmtDateTime(d)).toBe('Sat, 13 June · 4:30 PM')
})

test('whenLabel appends FT / live minute / nothing by status', () => {
  const ko = new Date('2026-06-13T06:30:00Z')
  const base = 'Sat, 13 June · 4:30 PM'
  expect(whenLabel({ ko, status: 'upcoming' })).toBe(base)
  expect(whenLabel({ ko, status: 'final' })).toBe(base + ' · FT')
  expect(whenLabel({ ko, status: 'live', minute: 67 })).toBe(base + " · 67'")
})

test('whenLabel prefers a precomputed dateTimeLabel when present', () => {
  expect(whenLabel({ dateTimeLabel: 'Sun, 14 June · 8:00 AM', status: 'upcoming' }))
    .toBe('Sun, 14 June · 8:00 AM')
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --root web src/lib/format.test.js`
Expected: FAIL — `fmtDate` / `fmtDateTime` / `whenLabel` are not exported.

- [ ] **Step 4: Rewrite `web/src/lib/format.js`**

Replace the file's date section. Final file:

```js
// Our team codes aren't all ISO 3166-1 alpha-2; map the odd ones to flagcdn codes.
const FLAG_FIX = {
  bih: 'ba', cgo: 'cd', cpv: 'cv', cur: 'cw', cze: 'cz',
  hai: 'ht', irq: 'iq', jor: 'jo', pan: 'pa', sco: 'gb-sct', uzb: 'uz',
}

export function flag(code, size) {
  size = size || 80
  const c = FLAG_FIX[code] || code
  if (c.indexOf('gb-') === 0) return 'https://flagcdn.com/' + c + '.svg'
  return 'https://flagcdn.com/w' + size + '/' + c + '.png'
}

export function gd(t) { return t.gf - t.ga }

// All formatters use the runtime's LOCAL timezone (no timeZone option).
export function fmtTime(d) {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase().replace(/\s/, ' ')
}
// "Sat, 13 June" — weekday short · day · full month.
export function fmtDate(d) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long' }).format(d)
}
// "Sat, 13 June · 4:30 PM" — the one canonical date+time string.
export function fmtDateTime(d) {
  return fmtDate(d) + ' · ' + fmtTime(d)
}
export function fmtDayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function fmtWeekday(d) {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(d)
}

// One-line fixture label: canonical date+time plus a status suffix.
// Prefers the precomputed f.dateTimeLabel, falling back to f.ko.
export function whenLabel(f) {
  const base = f.dateTimeLabel || fmtDateTime(f.ko)
  if (f.status === 'live') return `${base} · ${f.minute}'`
  if (f.status === 'final') return `${base} · FT`
  return base
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --root web src/lib/format.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add web/test/setup.js web/src/lib/format.js web/src/lib/format.test.js
git commit -m "feat(web): local timezone + canonical fmtDateTime/whenLabel

Drop the hardcoded Australia/Sydney; every formatter now uses the viewer's
local zone. Add fmtDate (full month), fmtDateTime ('Sun, 14 June · 8:00 AM'),
and whenLabel(f) for the one-line fixture label. Tests pin TZ=Australia/Sydney
in setup for determinism.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Bake `dateTimeLabel` onto fixtures + rename `fmtDay` → `fmtDate`

**Files:**
- Modify: `web/src/lib/assemble.js:1` (import), `:105` (label), `:137` (export)
- Modify: `web/src/data.js:1` (import), `:13` (export)
- Modify: `web/src/lib/assemble.test.js`

- [ ] **Step 1: Write the failing test**

In `web/src/lib/assemble.test.js`, add a test asserting each fixture carries `dateTimeLabel`. Append:

```js
test('each fixture gets a one-line dateTimeLabel', () => {
  const s = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null,
      prob: null, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  })
  // 2026-06-13T22:00Z = 2026-06-14 08:00 Sydney (TZ pinned in setup)
  expect(s.fixture('m1').dateTimeLabel).toBe('Sun, 14 June · 8:00 AM')
})
```

(If `assemble.test.js` does not already import `assembleSweep`, match the existing import style at the top of that file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root web src/lib/assemble.test.js`
Expected: FAIL — `dateTimeLabel` is `undefined`.

- [ ] **Step 3: Update `web/src/lib/assemble.js`**

Line 1 — change the import from `fmtDay` to `fmtDate` and add `fmtDateTime`:

```js
import { flag, gd, fmtTime, fmtDate, fmtDateTime, fmtDayKey, fmtWeekday } from './format.js'
```

Line ~105 — replace the label line inside the fixture map:

```js
      timeLabel: fmtTime(ko), dayLabel: fmtDate(ko), dayKey: fmtDayKey(ko),
      dateTimeLabel: fmtDateTime(ko),
```

Line ~137 — in the returned object, change `fmtDay` to `fmtDate` in the exported helper list:

```js
    team, fixture, flag, gd, ownersOf, ownersForFixture, fmtTime, fmtDate, fmtDayKey, fmtWeekday, todayKey,
```

- [ ] **Step 4: Update `web/src/data.js`**

Line 1 — change the import:

```js
import { flag, gd, fmtTime, fmtDate, fmtDayKey, fmtWeekday } from './lib/format.js'
```

Line ~13 — change the export inside `emptySweep()`:

```js
    flag, gd, fmtTime, fmtDate, fmtDayKey, fmtWeekday,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --root web src/lib/assemble.test.js src/data.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/assemble.js web/src/data.js web/src/lib/assemble.test.js
git commit -m "feat(web): bake dateTimeLabel onto fixtures; rename fmtDay->fmtDate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: MatchCard time + the two "today" stamps (drop AEST)

**Files:**
- Modify: `web/src/components.jsx:225` (MatchCard), `:270` & `:374` (today stamps), import line
- Modify: `web/src/components.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/components.test.jsx`, add a test that a `MatchCard` shows the one-line label and no "AEST". Find how `MatchCard` is imported/rendered in that file (reuse the existing pattern); append:

```js
test('MatchCard shows the one-line local date/time and no timezone label', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: null, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText, queryByText, container } = render(
    <MatchCard f={SWEEP.fixture('m1')} onOpen={noop} onToast={noop} />
  )
  expect(getByText('Sun, 14 June · 8:00 AM')).toBeTruthy()
  expect(queryByText(/AEST/)).toBeNull()
  expect(container.querySelector('.mc-time').textContent).not.toMatch(/AEST/)
})
```

If `MatchCard` / `setSweepData` / `SWEEP` are not already imported in this file, add them to the existing imports (the file already imports from `./components.jsx` and `./data.js` for other tests — follow that pattern; `setSweepData` comes from `./data.js`, `SWEEP` from `./data.js`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root web src/components.test.jsx -t "one-line local date"`
Expected: FAIL — the current label is e.g. `Sun, 14 Jun · 8:00 AM AEST`.

- [ ] **Step 3: Update `web/src/components.jsx`**

Add `whenLabel` and `fmtDate` to the imports from `./lib/format.js` (find the existing `from './lib/format.js'` import in this file and add them; if there is none, add `import { whenLabel, fmtDate } from './lib/format.js'`).

Line ~225 — replace the `mc-time` span:

```jsx
          <span className="mc-time">{whenLabel(f)}</span>
```

Line ~270 — replace the header "today" stamp:

```jsx
          <div className="tz"><b>{fmtDate(new Date())}</b></div>
```

Line ~374 — replace the sidebar footer "today" stamp:

```jsx
        <div className="dt" style={{marginTop:12}}><b>{fmtDate(new Date())}</b></div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root web src/components.test.jsx`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add web/src/components.jsx web/src/components.test.jsx
git commit -m "feat(web): MatchCard + today stamps use local one-line date, drop AEST

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Schedule subtitle (drop "Sydney time")

**Files:**
- Modify: `web/src/screens-main.jsx:280`

- [ ] **Step 1: Update the subtitle**

Line ~280 — change the `PageHeader` subtitle:

```jsx
      <PageHeader title="Schedule" sub="All group fixtures" tall
```

(The per-day headers at line ~302 already use `dayLabel`, which is now the localized full-month `fmtDate` output — no change needed there.)

- [ ] **Step 2: Verify the suite still passes**

Run: `npx vitest run --root web src/App.test.jsx`
Expected: PASS (App renders the Schedule screen on navigation; no assertion on the subtitle, so this is a regression check).

- [ ] **Step 3: Commit**

```bash
git add web/src/screens-main.jsx
git commit -m "feat(web): drop 'Sydney time' from the Schedule subtitle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Convert match-list rows + match-sheet caption + gpk-meta to the one-line format

**Files:**
- Modify: `web/src/screens-detail.jsx` — person rows (~117-142), team rows (~258-283), gpk-meta (~402), match-sheet caption (~553-554), import line
- Modify: `web/src/styles.css` (~428-441 mini-fx block)
- Modify: `web/src/screens-detail.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/screens-detail.test.jsx`, add a test that `PersonDetail`'s "All their matches" rows render the one-line label. First inspect the file's existing `PersonDetail` render helper/imports and reuse them. Append:

```js
test('PersonDetail match rows show the one-line local date/time', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: null, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText } = render(
    <PersonDetail person={SWEEP.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(getByText('Sun, 14 June · 8:00 AM')).toBeTruthy()
})
```

(Match the existing import lines in the file for `PersonDetail`, `setSweepData`/`setSweepData`, `assembleSweep`, `SWEEP`. If the file uses `setSweepData` from `./data.js`, reuse it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root web src/screens-detail.test.jsx -t "one-line local date"`
Expected: FAIL — the row currently renders a split weekday cell (`Sun`), not the full string.

- [ ] **Step 3: Add `whenLabel` to the imports in `screens-detail.jsx`**

Find the `from './lib/format.js'` import in `screens-detail.jsx` (or add one) and ensure it includes `whenLabel`. Example:

```js
import { whenLabel } from './lib/format.js'
```

- [ ] **Step 4: Rewrite the person match row (~117-142)**

Replace the `myFixtures.map(...)` row body with the stacked one-line layout:

```jsx
            {myFixtures.map(f=>{
              const myCode = person.teams.indexOf(f.t1)>=0 ? f.t1 : f.t2;
              const oppCode = myCode===f.t1 ? f.t2 : f.t1;
              const r = resultFor(f, myCode);
              const live = f.status==="live";
              return (
                <div className="mini-fx" key={f.id} onClick={()=>openMatch(f)}>
                  <div className="fx-main">
                    <div className="opp">
                      <Flag code={myCode} w={24} h={18}/>
                      <span className="nm">{S.team(myCode).name}</span>
                      <span className="vs">v</span>
                      <Flag code={oppCode} w={24} h={18}/>
                      <span className="nm">{S.team(oppCode).name}</span>
                    </div>
                    <div className={"fx-when"+(live?" live":"")}>{whenLabel(f)}</div>
                  </div>
                  <div className="rr">
                    {(f.status==="final"||live) && <span className="sc">{myCode===f.t1?f.score[0]:f.score[1]}–{myCode===f.t1?f.score[1]:f.score[0]}</span>}
                    {r && <span className={"res-pill "+r}>{r.toUpperCase()}</span>}
                    {f.status==="upcoming" && f.hasOdds && <span className="num" style={{fontSize:12,color:"var(--muted)",fontWeight:700}}>{f.prob3[myCode===f.t1?"pa":"pb"]}%</span>}
                  </div>
                </div>
              );
            })}
```

- [ ] **Step 5: Rewrite the team match row (~258-283) the same way**

In `TeamDetail`, the rows use the same `.mini-fx`/`.when` shape (lines ~266-267). Replace that row's `when` cell with the identical `fx-main`/`fx-when` structure. The team row computes its codes relative to the team `code`; preserve its existing `myCode`/`oppCode`/score/pill logic and only swap the leading `<div className="when">…</div>` cell for:

```jsx
                  <div className="fx-main">
                    <div className="opp">
                      {/* keep this row's existing Flag/name markup exactly as before */}
                    </div>
                    <div className={"fx-when"+(f.status==="live"?" live":"")}>{whenLabel(f)}</div>
                  </div>
```

Move the row's existing `.opp` block inside `fx-main` and drop the old stacked `.when` `<div>`. Keep the trailing `.rr` block unchanged.

- [ ] **Step 6: Update gpk-meta (~402)**

Replace the `gpk-meta` span to use the local date and drop reliance on the separate `timeLabel`:

```jsx
                        <span className="gpk-meta">{f.status==="final"?(f.score?`${f.score[0]}–${f.score[1]}`:"FT"):f.status==="live"?"LIVE":whenLabel(f)}</span>
```

- [ ] **Step 7: Update the match-sheet caption (~553-554), drop "AEST · "**

```jsx
              {showScore
                ? <span className="cd" style={{color:"var(--navy)",fontSize:34}}>{f.score[0]}–{f.score[1]}</span>
                : <span className="cd" style={{color:"var(--navy)",fontSize:20}}>{f.timeLabel}</span>}
              <span className="cdl" style={{color:"var(--muted2)"}}>{f.status==="live"?f.minute+"' · LIVE":f.status==="final"?"FULL TIME":f.dateTimeLabel}</span>
```

- [ ] **Step 8: Update the `.mini-fx` CSS in `web/src/styles.css`**

Replace the `.mini-fx .when*` rules (lines ~430-433) with a column main + one-line meta. Find:

```css
.mini-fx .when{width:52px; flex-shrink:0; text-align:center;}
.mini-fx .when .t{font-family:'Barlow Condensed'; font-weight:800; font-size:13px; line-height:1;}
.mini-fx .when .d{font-size:9px; color:var(--muted2); font-weight:700; margin-top:2px;}
.mini-fx .when.live .t{color:var(--live);}
```

Replace with:

```css
.mini-fx .fx-main{flex:1; min-width:0; display:flex; flex-direction:column; gap:3px;}
.mini-fx .fx-when{font-size:11px; color:var(--muted2); font-weight:600;}
.mini-fx .fx-when.live{color:var(--live);}
```

Then change `.mini-fx .opp` (line ~434) to no longer take `flex:1` (it now sits inside `fx-main`):

```css
.mini-fx .opp{display:flex; align-items:center; gap:8px; min-width:0;}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run --root web src/screens-detail.test.jsx`
Expected: PASS (whole file, including the existing MatchSheet tests).

- [ ] **Step 10: Commit**

```bash
git add web/src/screens-detail.jsx web/src/styles.css web/src/screens-detail.test.jsx
git commit -m "feat(web): one-line local date on match rows; drop AEST in sheet/gpk

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `predictionsOf` + `predictionAccuracy` helpers

**Files:**
- Modify: `web/src/social.js` (add after `predictionLeaderboard`, ~line 97)
- Modify: `web/src/social.test.js`

- [ ] **Step 1: Write the failing tests**

Inspect `web/src/social.test.js` for the existing `setSocialData` / `setSweepData` / `assembleSweep` import pattern and reuse it. Append:

```js
import { predictionsOf, predictionAccuracy } from './social.js'

function seed(fixtures, support) {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures, standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support })
}

const fx = (id, status, score) => ({
  id, group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
  venue: 'V', city: 'C', status, score, minute: null, prob: null, stage: 'group',
})

test('predictionsOf returns one entry per fixture the person picked, with verdicts', () => {
  seed(
    [fx('m1', 'final', [2, 1]), fx('m2', 'final', [0, 2]), fx('m3', 'upcoming', null)],
    { m1: { p1: 'hr' }, m2: { p1: 'hr' }, m3: { p1: 'en' } }
  )
  const out = predictionsOf('p1')
  expect(out.map(p => p.f.id)).toEqual(['m1', 'm2', 'm3'])
  expect(out.find(p => p.f.id === 'm1').verdict).toBe('correct') // hr won 2-1
  expect(out.find(p => p.f.id === 'm2').verdict).toBe('wrong')   // en won, picked hr
  expect(out.find(p => p.f.id === 'm3').verdict).toBe(null)      // not played
})

test('predictionsOf scores a DRAW pick correct on a level final', () => {
  seed([fx('m1', 'final', [1, 1])], { m1: { p1: 'DRAW' } })
  expect(predictionsOf('p1')[0].verdict).toBe('correct')
})

test('predictionsOf is empty for a person who picked nothing', () => {
  seed([fx('m1', 'final', [2, 1])], { m1: { p1: 'hr' } })
  expect(predictionsOf('pX')).toEqual([])
})

test('predictionAccuracy counts only resolved (final) predictions', () => {
  seed(
    [fx('m1', 'final', [2, 1]), fx('m2', 'final', [0, 2]), fx('m3', 'upcoming', null)],
    { m1: { p1: 'hr' }, m2: { p1: 'hr' }, m3: { p1: 'en' } }
  )
  expect(predictionAccuracy('p1')).toEqual({ correct: 1, total: 2 })
})

test('predictionAccuracy returns 0/0 when there are no resolved picks', () => {
  seed([fx('m1', 'upcoming', null)], { m1: { p1: 'hr' } })
  expect(predictionAccuracy('p1')).toEqual({ correct: 0, total: 0 })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root web src/social.test.js`
Expected: FAIL — `predictionsOf` / `predictionAccuracy` are not exported.

- [ ] **Step 3: Implement the helpers in `web/src/social.js`**

Insert after `predictionLeaderboard` (after line ~97), reusing the module-level `support`, `S`, and `DRAW`:

```js
/* a single person's prediction history: every fixture they picked, with a verdict.
   verdict: 'correct' | 'wrong' for finals (winner team, or DRAW on a level final),
   null for upcoming/live (unresolved). Sorted by kickoff ascending. */
export function predictionsOf(personId){
  const out = [];
  for (const f of S.fixtures){
    const pick = (support[f.id] || {})[personId];
    if (!pick) continue;
    let verdict = null;
    if (f.status === "final" && f.score){
      const [a, b] = f.score;
      const result = a > b ? f.t1 : b > a ? f.t2 : DRAW;
      verdict = pick === result ? "correct" : "wrong";
    }
    out.push({ f, pick, verdict });
  }
  return out.sort((x, y) => x.f.ko - y.f.ko);
}

/* resolved-only accuracy for the header tile: { correct, total } over finals. */
export function predictionAccuracy(personId){
  const preds = predictionsOf(personId).filter(p => p.f.status === "final" && p.f.score);
  return { correct: preds.filter(p => p.verdict === "correct").length, total: preds.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root web src/social.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/social.js web/src/social.test.js
git commit -m "feat(web): predictionsOf + predictionAccuracy helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Prediction history section + accuracy tile on the profile

**Files:**
- Modify: `web/src/screens-detail.jsx` — `PersonDetail` (header tiles ~86-90; new section between Teams drawn and All their matches ~115), import line
- Modify: `web/src/styles.css` — verdict pills + pick highlight + DRAW chip
- Modify: `web/src/screens-detail.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/screens-detail.test.jsx`:

```js
test('PersonDetail shows a Calls-right accuracy tile', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [
      { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
        venue: 'V', city: 'C', status: 'final', score: [2, 1], minute: null, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: { m1: { p1: 'hr' } } })
  const noop = () => {}
  const { getByText } = render(
    <PersonDetail person={SWEEP.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(getByText('Calls right')).toBeTruthy()
  expect(getByText('1/1')).toBeTruthy()
})

test('PersonDetail prediction history shows the pick and a correct verdict', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures: [
      { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
        venue: 'V', city: 'C', status: 'final', score: [2, 1], minute: null, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: { m1: { p1: 'hr' } } })
  const noop = () => {}
  const { getByText, container } = render(
    <PersonDetail person={SWEEP.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(getByText('Prediction history')).toBeTruthy()
  // picked Croatia → its name carries the pick highlight class
  const pick = [...container.querySelectorAll('.nm.pick')].find(n => n.textContent === 'Croatia')
  expect(pick).toBeTruthy()
  expect(container.querySelector('.v-pill.ok')).toBeTruthy()
})

test('PersonDetail shows an empty state when the person made no predictions', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 }],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
  const noop = () => {}
  const { getByText } = render(
    <PersonDetail person={SWEEP.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(getByText('No predictions yet.')).toBeTruthy()
})
```

Ensure the file imports `setSocialData` (from `./social.js`) — add it if missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root web src/screens-detail.test.jsx -t "Prediction history"`
Expected: FAIL — section and tile do not exist.

- [ ] **Step 3: Import the helpers in `screens-detail.jsx`**

Add to the existing `from './social.js'` import (line ~11): `predictionsOf, predictionAccuracy, DRAW`. (`DRAW` may already be imported there — do not duplicate.)

- [ ] **Step 4: Add the accuracy tile to the header (~86-90)**

Inside `PersonDetail`, before the `return`, compute accuracy:

```jsx
  const acc = predictionAccuracy(person.id);
  const preds = predictionsOf(person.id);
```

Then add a 4th `dh-stat` tile in the `dh-stats` block:

```jsx
          <div className="dh-stats">
            <div className="dh-stat"><b>{myTeams.length}</b><small>Teams drawn</small></div>
            <div className="dh-stat"><b>{played.length}</b><small>Games played</small></div>
            <div className="dh-stat"><b>{wins}</b><small>Wins</small></div>
            <div className="dh-stat"><b>{acc.correct}/{acc.total}</b><small>Calls right</small></div>
          </div>
```

- [ ] **Step 5: Add the "Prediction history" section**

Insert between the "Teams drawn" block and the "All their matches" `sec-h` (i.e. just before `<div className="sec-h"><h2>All their matches</h2></div>` at ~line 115):

```jsx
          <div className="sec-h"><h2>Prediction history</h2></div>
          <div className="block">
            {preds.length===0
              ? <div className="pred-empty">No predictions yet.</div>
              : preds.map(({f, pick, verdict})=>{
                  const live = f.status==="live";
                  const isDraw = pick===DRAW;
                  return (
                    <div className="mini-fx" key={f.id} onClick={()=>openMatch(f)}>
                      <div className="fx-main">
                        <div className="opp">
                          <Flag code={f.t1} w={24} h={18}/>
                          <span className={"nm"+(!isDraw&&pick===f.t1?" pick":"")}>{S.team(f.t1).name}</span>
                          <span className="vs">v</span>
                          <Flag code={f.t2} w={24} h={18}/>
                          <span className={"nm"+(!isDraw&&pick===f.t2?" pick":"")}>{S.team(f.t2).name}</span>
                          {isDraw && <span className="draw-chip">DRAW</span>}
                        </div>
                        <div className={"fx-when"+(live?" live":"")}>{whenLabel(f)}</div>
                      </div>
                      <div className="rr">
                        {(f.status==="final"||live) && f.score && <span className="sc">{f.score[0]}–{f.score[1]}</span>}
                        {verdict==="correct" && <span className="v-pill ok" title="Correct call">✓</span>}
                        {verdict==="wrong" && <span className="v-pill no" title="Wrong call">✗</span>}
                        {verdict===null && <span className="v-pill pending">pending</span>}
                      </div>
                    </div>
                  );
                })}
          </div>
```

(`whenLabel` is already imported from Task 5; `Flag` and `S` are already in scope in this file.)

- [ ] **Step 6: Add CSS to `web/src/styles.css`**

After the `.res-pill` rule (~line 441), add:

```css
.mini-fx .opp .nm.pick{color:var(--navy); font-weight:800;}
.draw-chip{font-size:9px; font-weight:800; letter-spacing:.5px; color:var(--muted2); border:1px solid var(--line); border-radius:5px; padding:1px 5px; flex-shrink:0;}
.mini-fx .rr .v-pill{font-size:9px; font-weight:800; min-width:18px; height:18px; padding:0 5px; border-radius:5px; display:grid; place-items:center; color:#fff;}
.v-pill.ok{background:var(--live);} .v-pill.no{background:var(--accent);}
.v-pill.pending{background:transparent; color:var(--muted2); border:1px solid var(--line); font-size:8.5px; font-weight:700;}
.pred-empty{font-size:12.5px; color:var(--muted2); font-weight:600; padding:6px 4px;}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --root web src/screens-detail.test.jsx`
Expected: PASS (whole file).

- [ ] **Step 8: Commit**

```bash
git add web/src/screens-detail.jsx web/src/styles.css web/src/screens-detail.test.jsx
git commit -m "feat(web): prediction history section + Calls-right tile on profile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full-suite + build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole web suite**

Run: `npx vitest run --root web`
Expected: PASS — all test files green (the three new tests plus the prior 133).

- [ ] **Step 2: Production build**

Run: `npm run build -w web`
Expected: `✓ built` with no errors.

- [ ] **Step 3: Manual spot-check (optional but recommended)**

Run `npm run dev:web`, open a person's profile, and confirm: the new "Prediction history" section renders with pick highlight + verdict pills; the "Calls right" tile shows; dates everywhere read `Sun, 14 June · 8:00 AM` in your local zone with no "AEST"/"Sydney".

- [ ] **Step 4: Finalize the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge vs. PR.

---

## Self-Review Notes

- **Spec coverage:** local zone (T1), full-month unified `fmtDateTime` (T1), `dateTimeLabel` baked (T2), all display sites swapped + TZ labels dropped — MatchCard/today-stamps (T3), Schedule subtitle (T4), match rows/sheet/gpk (T5); `predictionsOf`/`predictionAccuracy` (T6); prediction history section + 4th "Calls right" tile + empty state + DRAW chip + pick highlight + verdict pills (T7); regression sweep via full suite (T8). All spec sections map to a task.
- **Type/name consistency:** `fmtDate`, `fmtDateTime`, `whenLabel`, `dateTimeLabel`, `predictionsOf`, `predictionAccuracy`, classes `.fx-main`/`.fx-when`/`.v-pill`/`.nm.pick`/`.draw-chip`/`.pred-empty` are used identically across tasks.
- **No backend change:** confirmed — all reads are over existing client state.
