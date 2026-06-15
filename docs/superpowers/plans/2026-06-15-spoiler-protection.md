# Spoiler Protection (Privacy Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in spoiler-protection mode that hides finished/live match scores behind a tappable "eye-off" cover and suppresses match-event popups for still-hidden matches.

**Architecture:** A new module-store (`web/src/spoiler.js`) holds a device-global on/off boolean (`localStorage` key `sweep.spoiler.v1`, default OFF) plus an in-memory `Set` of revealed fixture ids (cleared on reload). A shared `<ScoreCover>` button replaces the score at each render site when `spoilerHidden(f)` is true; tapping it reveals that match for the session. A single `<SpoilerToggle>` flips the mode from the desktop Sidebar and the mobile headers. `<FloatingReactions>` drops `kind:"match"` popups for hidden matches.

**Tech Stack:** React 18, plain global CSS, Vitest + React Testing Library. Store pattern mirrors `web/src/sweeps.js`.

**Spec:** `docs/superpowers/specs/2026-06-15-spoiler-protection-design.md`

---

## File Structure

- **Create** `web/src/spoiler.js` — the store (`isSpoiler`, `setSpoiler`, `reveal`, `isRevealed`, `spoilerHidden`, `useSpoiler`).
- **Create** `web/src/spoiler.test.js` — store unit tests.
- **Modify** `web/src/components.jsx` — add `Icon.eyeoff`; add exported `ScoreCover` + `SpoilerToggle`; wire `MatchCard`; place `SpoilerToggle` in `HomeHeader`, `PageHeader`, `Sidebar`.
- **Modify** `web/src/screens-main.jsx` — wire the "Latest scores" row and the hero live scoreline.
- **Modify** `web/src/screens-detail.jsx` — wire `MatchSheet`, `PersonDetail` row, `TeamDetail` row, `gpk-meta`.
- **Modify** `web/src/FloatingReactions.jsx` — gate match-event popups.
- **Modify** `web/src/styles.css` — `.spoiler-cover` styles.
- **Modify** `web/src/desktop.css` — hide the mobile header toggle on desktop.
- **Modify** test files: `web/src/components.test.jsx`, `web/src/screens-detail.test.jsx`, `web/src/FloatingReactions.test.jsx`.

**Commands:** run a single test file with `npm run test -w web -- <path>`; the full suite with `npm run test`; the build with `npm run build`. (The repo pre-commit hook already runs the full web suite + build on every commit.)

---

## Task 1: Spoiler store (`spoiler.js`)

**Files:**
- Create: `web/src/spoiler.js`
- Test: `web/src/spoiler.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/src/spoiler.test.js`:

```js
import { expect, test, beforeEach } from 'vitest'
import {
  isSpoiler, setSpoiler, reveal, isRevealed, spoilerHidden,
} from './spoiler.js'

const fin = { id: 'm1', status: 'final', score: [2, 0] }
const liveFx = { id: 'm2', status: 'live', score: [1, 1] }
const up = { id: 'm3', status: 'upcoming', score: null }

beforeEach(() => {
  localStorage.clear()
  setSpoiler(false) // reset persisted flag + in-memory mirror
})

test('defaults OFF when nothing is stored', () => {
  localStorage.clear()
  expect(isSpoiler()).toBe(false)
  expect(spoilerHidden(fin)).toBe(false)
})

test('setSpoiler(true) turns the mode on and persists', () => {
  setSpoiler(true)
  expect(isSpoiler()).toBe(true)
  expect(localStorage.getItem('sweep.spoiler.v1')).toBe('1')
  setSpoiler(false)
  expect(isSpoiler()).toBe(false)
})

test('hides final AND live fixtures (with a score) when on; never upcoming', () => {
  setSpoiler(true)
  expect(spoilerHidden(fin)).toBe(true)
  expect(spoilerHidden(liveFx)).toBe(true)
  expect(spoilerHidden(up)).toBe(false)
})

test('reveal(id) un-hides only that fixture', () => {
  setSpoiler(true)
  reveal('m1')
  expect(isRevealed('m1')).toBe(true)
  expect(spoilerHidden(fin)).toBe(false)   // m1 revealed
  expect(spoilerHidden(liveFx)).toBe(true) // m2 still hidden
})

test('enabling the mode clears previously revealed matches', () => {
  setSpoiler(true)
  reveal('m1')
  expect(isRevealed('m1')).toBe(true)
  setSpoiler(false)
  setSpoiler(true)            // re-enabling re-hides everything fresh
  expect(isRevealed('m1')).toBe(false)
  expect(spoilerHidden(fin)).toBe(true)
})

test('nothing is hidden while the mode is off', () => {
  setSpoiler(false)
  expect(spoilerHidden(fin)).toBe(false)
  expect(spoilerHidden(liveFx)).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- src/spoiler.test.js`
Expected: FAIL — `Failed to resolve import "./spoiler.js"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/spoiler.js`:

```js
// web/src/spoiler.js
// Device-global "spoiler protection" preference + ephemeral per-match reveal state.
// Mirrors the module-store pattern in sweeps.js / social.js: a localStorage-backed
// flag, a listeners Set, and a useSpoiler() hook that force-re-renders subscribers.
import { useState, useEffect } from 'react'

const KEY = 'sweep.spoiler.v1'
const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

// In-memory mirror so the toggle still works in-session when localStorage is
// unavailable (private mode). localStorage is the source of truth when readable.
let mem = false
function read() {
  try { return localStorage.getItem(KEY) === '1' } catch { return mem }
}

// Revealed fixture ids — in-memory only, so they reset on reload (the core promise).
const revealed = new Set()

/** @returns {boolean} whether spoiler protection is currently on */
export function isSpoiler() { return read() }

/** Turn the mode on/off. Enabling re-hides everything (clears the reveal set). */
export function setSpoiler(on) {
  const v = !!on
  mem = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private mode */ }
  if (v) revealed.clear()
  notify()
}

/** Reveal a single match's score for the rest of this session. */
export function reveal(id) { revealed.add(id); notify() }

/** @returns {boolean} whether `id` has been revealed this session */
export function isRevealed(id) { return revealed.has(id) }

/** Single source of truth: should this fixture's score be covered right now? */
export function spoilerHidden(f) {
  return isSpoiler()
    && !!f && (f.status === 'final' || f.status === 'live')
    && !!f.score && !revealed.has(f.id)
}

/** Reactive hook — re-renders the caller when the mode or reveal set changes. */
export function useSpoiler() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((x) => x + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
  return { on: isSpoiler(), setSpoiler, reveal }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- src/spoiler.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/spoiler.js web/src/spoiler.test.js
git commit -m "feat(web): spoiler-protection store (device flag + session reveal set)"
```

---

## Task 2: `Icon.eyeoff`, `<ScoreCover>`, `<SpoilerToggle>`

**Files:**
- Modify: `web/src/components.jsx` (imports ~line 12; `Icon` map ~line 39; new components after `WatchBtn` ~line 59)
- Modify: `web/src/styles.css` (append `.spoiler-cover` block after the `.watchbtn` block, ~line 229)
- Test: `web/src/components.test.jsx` (add cases)

- [ ] **Step 1: Write the failing test**

Add to `web/src/components.test.jsx`. First extend the import on line 12 to include the two new components, and add a spoiler-store import near the other store imports (after line 13):

```jsx
import { Av, CrowdPick, IdentityControl, MatchCard, ProbBar, SquadList, useCountdown, SweepsSheet, Sidebar, HomeHeader, ScoreCover, SpoilerToggle } from './components.jsx'
import { isSpoiler, setSpoiler, isRevealed } from './spoiler.js'
```

Then append these tests at the end of the file:

```jsx
test('SpoilerToggle reflects and flips the mode', () => {
  setSpoiler(false)
  const { getByLabelText } = render(<SpoilerToggle />)
  const btn = getByLabelText(/spoiler protection/i)
  expect(btn.getAttribute('aria-pressed')).toBe('false')
  act(() => { fireEvent.click(btn) })
  expect(isSpoiler()).toBe(true)
  expect(btn.getAttribute('aria-pressed')).toBe('true')
  setSpoiler(false)
})

test('ScoreCover reveals its fixture when tapped', () => {
  setSpoiler(true)
  const { getByLabelText } = render(<ScoreCover f={{ id: 'mX' }} />)
  expect(isRevealed('mX')).toBe(false)
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(isRevealed('mX')).toBe(true)
  setSpoiler(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- src/components.test.jsx -t "SpoilerToggle|ScoreCover"`
Expected: FAIL — `ScoreCover` / `SpoilerToggle` are not exported (import error or "not a function").

- [ ] **Step 3: Write the minimal implementation**

In `web/src/components.jsx`, add the spoiler import after line 13 (`import { ... } from "./api/client.js";`):

```jsx
import { useSpoiler, spoilerHidden, reveal as revealScore } from "./spoiler.js";
```

Add `eyeoff` to the `Icon` map (after the `eye` entry on line 39):

```jsx
  eyeoff:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0112 5c6 0 10 7 10 7a18.4 18.4 0 01-3.2 4M6.7 6.7A18.4 18.4 0 002 12s4 7 10 7a10.8 10.8 0 004.3-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>,
```

Add the two components immediately after `WatchBtn` (after line 59):

```jsx
/* spoiler protection: a tap-to-reveal cover shown in place of a hidden score */
export function ScoreCover({ f, dark }) {
  function click(e){ e.stopPropagation(); revealScore(f.id); }
  return (
    <button type="button" className={"spoiler-cover" + (dark ? " dark" : "")} onClick={click}
      aria-label="Reveal score" title="Tap to reveal score">
      <Icon.eyeoff/>
    </button>
  );
}

/* spoiler protection toggle — pill in the desktop sidebar, round icon in mobile headers */
export function SpoilerToggle({ compact }) {
  const { on, setSpoiler } = useSpoiler();
  const Ic = on ? Icon.eyeoff : Icon.eye;
  const label = "Spoiler protection " + (on ? "on" : "off");
  if (compact) {
    return (
      <button type="button" className="spoiler-tog compact" onClick={()=>setSpoiler(!on)}
        aria-pressed={on} aria-label={label} title={on ? "Scores hidden" : "Hide scores"}
        style={{width:30,height:30,borderRadius:9,background:"rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}>
        <Ic style={{width:15,height:15,stroke:"#9fb6d6"}}/>
      </button>
    );
  }
  return (
    <button type="button" className={"sb-item spoiler-tog" + (on ? " on" : "")} onClick={()=>setSpoiler(!on)}
      aria-pressed={on} aria-label={label}>
      <Ic/><span>{on ? "Scores hidden" : "Hide scores"}</span>
    </button>
  );
}
```

In `web/src/styles.css`, append after the `.watchbtn` block (after line 229):

```css
/* spoiler protection */
.spoiler-cover{display:inline-flex; align-items:center; justify-content:center; background:#eef1f5; color:var(--muted2); border:0; border-radius:8px; padding:3px 11px; cursor:pointer; flex-shrink:0;}
.spoiler-cover svg{width:16px; height:16px; stroke:currentColor;}
.spoiler-cover.dark{background:rgba(255,255,255,.16); color:#fff;}
.sb-item.spoiler-tog.on{color:var(--accent);}
.sb-item.spoiler-tog.on svg{stroke:var(--accent);}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- src/components.test.jsx -t "SpoilerToggle|ScoreCover"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components.jsx web/src/styles.css web/src/components.test.jsx
git commit -m "feat(web): eye-off icon, ScoreCover, and SpoilerToggle components"
```

---

## Task 3: Wire `MatchCard`

**Files:**
- Modify: `web/src/components.jsx` (`MatchCard`, lines 215-250)
- Test: `web/src/components.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `web/src/components.test.jsx`:

```jsx
function finalCard() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [3, 1], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
}

test('MatchCard covers a final score under spoiler mode and reveals on tap', () => {
  finalCard()
  setSpoiler(true)
  const noop = () => {}
  const { queryByText, getByLabelText } = render(<MatchCard f={SWEEP.fixture('m1')} onOpen={noop} onToast={noop} />)
  expect(queryByText('3')).toBeNull()                 // score not rendered
  expect(getByLabelText(/reveal score/i)).toBeTruthy() // cover present
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(queryByText('3')).toBeTruthy()                // real score now shown
  setSpoiler(false)
})

test('MatchCard shows the score normally when spoiler mode is off', () => {
  finalCard()
  setSpoiler(false)
  const noop = () => {}
  const { getByText, queryByLabelText } = render(<MatchCard f={SWEEP.fixture('m1')} onOpen={noop} onToast={noop} />)
  expect(getByText('3')).toBeTruthy()
  expect(queryByLabelText(/reveal score/i)).toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- src/components.test.jsx -t "MatchCard covers"`
Expected: FAIL — the cover button is absent; `getByLabelText(/reveal score/i)` throws.

- [ ] **Step 3: Write the minimal implementation**

In `web/src/components.jsx`, inside `MatchCard` add a spoiler subscription right after `useSocial();` (line 216):

```jsx
  useSocial();
  useSpoiler();
```

Replace the score block (lines 246-250):

```jsx
        <div className="mc-h-mid">
          {showScore
            ? <span className="mc-sc">{s1}<i>–</i>{s2}</span>
            : <span className="mc-vs">VS</span>}
        </div>
```

with:

```jsx
        <div className="mc-h-mid">
          {showScore
            ? (spoilerHidden(f) ? <ScoreCover f={f}/> : <span className="mc-sc">{s1}<i>–</i>{s2}</span>)
            : <span className="mc-vs">VS</span>}
        </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- src/components.test.jsx -t "MatchCard covers|MatchCard shows the score normally"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components.jsx web/src/components.test.jsx
git commit -m "feat(web): cover MatchCard scores under spoiler mode"
```

---

## Task 4: Wire "Latest scores" + hero (`screens-main.jsx`)

**Files:**
- Modify: `web/src/screens-main.jsx` (imports 6-10; `HomeScreen` `useSocial()` ~line 58; latest-scores ~line 117; hero ~line 170)
- Test: `web/src/components.test.jsx` (HomeScreen renders here)

- [ ] **Step 1: Write the failing test**

Append to `web/src/components.test.jsx` (it already imports `HomeScreen`):

```jsx
test('HomeScreen latest-scores covers finals under spoiler mode, reveals on tap', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [4, 2], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group', events: [],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSpoiler(true)
  const noop = () => {}
  const { container, queryByText, getAllByLabelText } = render(
    <HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />
  )
  expect(container.querySelector('.sidescores .rscore')).toBeNull() // no raw scoreline
  const covers = getAllByLabelText(/reveal score/i)
  act(() => { fireEvent.click(covers[0]) })
  expect(queryByText('4 – 2')).toBeTruthy()
  setSpoiler(false)
})

test('HomeScreen hero covers a live score under spoiler mode', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'ar', name: 'Argentina', group: 'A', pool: 'P', color: '#6cf', strength: 90 },
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [
      { id: 'live1', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-13T06:30:00Z', venue: 'V', city: 'C', status: 'live', score: [2, 0], minute: 63, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSpoiler(true)
  const noop = () => {}
  const { queryByText, getByLabelText } = render(
    <HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />
  )
  expect(queryByText('2–0')).toBeNull()                 // live score covered
  expect(getByLabelText(/reveal score/i)).toBeTruthy()  // cover present
  expect(queryByText("63' · LIVE")).toBeTruthy()        // LIVE label still shown
  setSpoiler(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- src/components.test.jsx -t "latest-scores covers|hero covers a live"`
Expected: FAIL — scores still render; covers absent.

- [ ] **Step 3: Write the minimal implementation**

In `web/src/screens-main.jsx`, extend the components import (lines 6-9) to include `ScoreCover`, and add a spoiler import after line 10:

```jsx
import {
  Icon, Flag, Av, AvStack, PersonAvatar, ProbBar, MatchCard, CrowdPick, HomeHeader, PageHeader,
  SearchInput, useCountdown, useIsDesktop, ScoreCover,
} from "./components.jsx";
import { useSocial, getMe, isWatching, toast, predictionLeaderboard } from "./social.js";
import { useSpoiler, spoilerHidden } from "./spoiler.js";
```

Subscribe `HomeScreen` to spoiler changes — add right after `useSocial();` (line 58):

```jsx
  useSocial(); // re-render on identity / watch / support changes
  useSpoiler();
```

Replace the latest-scores scoreline (line 117):

```jsx
                <span className="rscore">{f.score[0]} – {f.score[1]}</span>
```

with:

```jsx
                {spoilerHidden(f) ? <ScoreCover f={f}/> : <span className="rscore">{f.score[0]} – {f.score[1]}</span>}
```

Replace the hero live branch (line 170):

```jsx
              ? <><span className="cd">{next.score[0]}–{next.score[1]}</span><span className="cdl">{next.minute}' · LIVE</span></>
```

with:

```jsx
              ? <>{spoilerHidden(next) ? <ScoreCover f={next} dark/> : <span className="cd">{next.score[0]}–{next.score[1]}</span>}<span className="cdl">{next.minute}' · LIVE</span></>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- src/components.test.jsx -t "latest-scores covers|hero covers a live"`
Expected: PASS (2 tests). Then run the whole file to confirm no regression in the existing latest-scores/hero tests:
Run: `npm run test -w web -- src/components.test.jsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-main.jsx web/src/components.test.jsx
git commit -m "feat(web): cover Latest-scores rows and hero live score under spoiler mode"
```

---

## Task 5: Wire `MatchSheet`, `PersonDetail`, `TeamDetail`, `gpk-meta` (`screens-detail.jsx`)

**Files:**
- Modify: `web/src/screens-detail.jsx` (imports 8-10; `PersonDetail` ~66; `TeamDetail` ~243; `UploadSheet` ~352; `gpk-meta` ~440; `MatchSheet` ~564, 589-591; `PersonDetail` row ~143; `TeamDetail` row ~309)
- Test: `web/src/screens-detail.test.jsx`

- [ ] **Step 1: Write the failing test**

First, inspect the top of `web/src/screens-detail.test.jsx` to reuse its existing seed helpers and imports. Then add this test (it renders `MatchSheet`, already exercised elsewhere in that file). Add a spoiler-store import alongside the file's existing imports:

```jsx
import { setSpoiler } from './spoiler.js'
```

Add the test:

```jsx
test('MatchSheet covers a final score under spoiler mode, reveals on tap', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [5, 1], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group', events: [],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSpoiler(true)
  const noop = () => {}
  const { queryByText, getByLabelText } = render(
    <MatchSheet f={SWEEP.fixture('m1')} onClose={noop} onToast={noop} openTeam={noop} openPerson={noop} openPhoto={noop} />
  )
  expect(queryByText('5–1')).toBeNull()
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(queryByText('5–1')).toBeTruthy()
  setSpoiler(false)
})
```

Ensure `MatchSheet`, `setSweepData`, `SWEEP`, `assembleSweep`, `render`, `fireEvent`, `act` are imported in this file (most already are; add any missing ones following the existing import block).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- src/screens-detail.test.jsx -t "MatchSheet covers"`
Expected: FAIL — the score still renders; cover absent.

- [ ] **Step 3: Write the minimal implementation**

In `web/src/screens-detail.jsx`, extend the components import (lines 8-10) to include `ScoreCover`, and add a spoiler import after line 10's import block (after the `social.js` import that ends around line 12-30 — place it immediately after the `from "./components.jsx";` line for clarity):

```jsx
import {
  Icon, Flag, AvStack, PersonAvatar, MatchCard, PageHeader, SearchInput, SquadList, resultFor, useCountdown, ScoreCover,
} from "./components.jsx";
import { useSpoiler, spoilerHidden } from "./spoiler.js";
```

**MatchSheet** — add `useSpoiler();` after `useSocial();` (line 564), then replace the showScore branch (lines 589-591):

```jsx
              {showScore
                ? <span className="cd" style={{color:"var(--navy)",fontSize:34}}>{f.score[0]}–{f.score[1]}</span>
                : <span className="cd" style={{color:"var(--navy)",fontSize:20}}>{f.timeLabel}</span>}
```

with:

```jsx
              {showScore
                ? (spoilerHidden(f) ? <ScoreCover f={f}/> : <span className="cd" style={{color:"var(--navy)",fontSize:34}}>{f.score[0]}–{f.score[1]}</span>)
                : <span className="cd" style={{color:"var(--navy)",fontSize:20}}>{f.timeLabel}</span>}
```

**PersonDetail** — add `useSpoiler();` after its `useSocial();` (line 66), then replace the score span (line 143):

```jsx
                    {(f.status==="final"||live) && <span className="sc">{myCode===f.t1?f.score[0]:f.score[1]}–{myCode===f.t1?f.score[1]:f.score[0]}</span>}
```

with:

```jsx
                    {(f.status==="final"||live) && (spoilerHidden(f) ? <ScoreCover f={f}/> : <span className="sc">{myCode===f.t1?f.score[0]:f.score[1]}–{myCode===f.t1?f.score[1]:f.score[0]}</span>)}
```

**TeamDetail** — it does not currently subscribe to social; add `useSpoiler();` as the first line of the component body (right after `export function TeamDetail({ ... }) {` on line 243). Then replace the score span (line 309):

```jsx
                    {(f.status==="final"||live) && <span className="sc">{f.t1===code?f.score[0]:f.score[1]}–{f.t1===code?f.score[1]:f.score[0]}</span>}
```

with:

```jsx
                    {(f.status==="final"||live) && (spoilerHidden(f) ? <ScoreCover f={f}/> : <span className="sc">{f.t1===code?f.score[0]:f.score[1]}–{f.t1===code?f.score[1]:f.score[0]}</span>)}
```

**UploadSheet `gpk-meta`** — add `useSpoiler();` as the first line of the `UploadSheet` body (after line 352), then replace the meta span (line 440). The picker buttons are themselves the tap target (they select the game), so this site shows a **static** eye-off glyph rather than a reveal button:

```jsx
                        <span className="gpk-meta">{f.status==="final"?(f.score?`${f.score[0]}–${f.score[1]}`:"FT"):f.status==="live"?"LIVE":whenLabel(f)}</span>
```

with:

```jsx
                        <span className="gpk-meta">{spoilerHidden(f) ? <Icon.eyeoff style={{width:13,height:13,stroke:"var(--muted2)"}}/> : f.status==="final"?(f.score?`${f.score[0]}–${f.score[1]}`:"FT"):f.status==="live"?"LIVE":whenLabel(f)}</span>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- src/screens-detail.test.jsx -t "MatchSheet covers"`
Expected: PASS. Then the whole file:
Run: `npm run test -w web -- src/screens-detail.test.jsx`
Expected: PASS (all) — confirms the PersonDetail/TeamDetail row edits didn't regress existing detail tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx
git commit -m "feat(web): cover MatchSheet, person/team rows, and game-picker scores under spoiler mode"
```

---

## Task 6: Gate match-event popups (`FloatingReactions.jsx`)

**Files:**
- Modify: `web/src/FloatingReactions.jsx` (imports ~line 9; `onNotification` handler ~line 18)
- Test: `web/src/FloatingReactions.test.jsx`

- [ ] **Step 1: Write the failing test**

Add a spoiler-store import to `web/src/FloatingReactions.test.jsx` (after line 6):

```jsx
import { setSpoiler, reveal } from './spoiler.js'
```

Reset spoiler state inside the existing `beforeEach` (append at the end of it, after the `setSweepData(...)` call, before the closing `})`):

```jsx
  setSpoiler(false)
```

Add these tests:

```jsx
test('suppresses a match-event popup while its match is hidden', () => {
  setSpoiler(true)
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ kind: 'match', event: 'goal', fixtureId: 'm1', teamCode: 'br', player: 'Neymar', minute: 23, detail: 'Normal Goal', score: [1, 0] }) })
  expect(container.textContent).not.toContain('Goal!')
  setSpoiler(false)
})

test('lets a match-event popup through once its match is revealed', () => {
  setSpoiler(true)
  reveal('m1')
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ kind: 'match', event: 'goal', fixtureId: 'm1', teamCode: 'br', player: 'Neymar', minute: 23, detail: 'Normal Goal', score: [1, 0] }) })
  expect(container.textContent).toContain('Goal!')
  setSpoiler(false)
})

test('social "backing" reactions are never suppressed by spoiler mode', () => {
  setSpoiler(true)
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ personId: 'p1', teamCode: 'br', fixtureId: 'm1', action: 'pick' }) })
  expect(container.textContent).toContain('is backing')
  setSpoiler(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- src/FloatingReactions.test.jsx -t "suppresses a match-event"`
Expected: FAIL — the goal popup renders ("Goal!" present) because no gate exists yet.

- [ ] **Step 3: Write the minimal implementation**

In `web/src/FloatingReactions.jsx`, add the import after line 9 (`import { DRAW } from "./social.js";`):

```jsx
import { isSpoiler, isRevealed } from "./spoiler.js";
```

Add the gate as the first statement inside the `onNotification` callback (line 18, before `const fx = S.fixture(n.fixtureId);`):

```jsx
  useEffect(() => onNotification((n) => {
    // spoiler mode: suppress match-event popups (goal/card/kick-off/full-time) for a
    // still-hidden match — they would announce the score/result. Social reactions pass.
    if (n.kind === "match" && isSpoiler() && !isRevealed(n.fixtureId)) return;
    // resolve from already-loaded data; skip silently if we can't render it
    const fx = S.fixture(n.fixtureId);
    if (!fx) return;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- src/FloatingReactions.test.jsx`
Expected: PASS (all — the 3 new tests plus the 7 existing match/social ones, since the existing match tests run with spoiler OFF via the `beforeEach` reset).

- [ ] **Step 5: Commit**

```bash
git add web/src/FloatingReactions.jsx web/src/FloatingReactions.test.jsx
git commit -m "feat(web): mute match-event popups for spoiler-hidden matches"
```

---

## Task 7: Place `<SpoilerToggle>` in the chrome (Sidebar, HomeHeader, PageHeader)

**Files:**
- Modify: `web/src/components.jsx` (`HomeHeader` ~280-293; `PageHeader` ~304-311; `Sidebar` ~394-398)
- Modify: `web/src/desktop.css` (hide the mobile header toggle on desktop)
- Test: `web/src/components.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `web/src/components.test.jsx`:

```jsx
test('Sidebar renders the spoiler toggle', () => {
  const noop = () => {}
  const { getByLabelText } = render(<Sidebar current="home" go={noop} onKnock={noop} onAdmin={noop} />)
  expect(getByLabelText(/spoiler protection/i)).toBeTruthy()
})

test('HomeHeader renders the spoiler toggle', () => {
  const noop = () => {}
  const { getByLabelText } = render(<HomeHeader onAdmin={noop} go={noop} />)
  expect(getByLabelText(/spoiler protection/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- src/components.test.jsx -t "renders the spoiler toggle"`
Expected: FAIL — no toggle in either chrome component yet.

- [ ] **Step 3: Write the minimal implementation**

In `web/src/components.jsx`:

**HomeHeader** — add `<SpoilerToggle compact/>` as the first item in the right-hand button row. Replace the opening of that `div` (line 280-281):

```jsx
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div className="tz"><b>{fmtDate(new Date())}</b></div>
```

with:

```jsx
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div className="tz"><b>{fmtDate(new Date())}</b></div>
          <SpoilerToggle compact/>
```

**PageHeader** — render the toggle next to the existing `right` slot. Replace line 310 (`{right}`):

```jsx
        {right}
```

with:

```jsx
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <SpoilerToggle compact/>
          {right}
        </div>
```

**Sidebar** — add `<SpoilerToggle/>` (full pill) in the footer. Replace the `sb-foot` block (lines 394-398):

```jsx
      <div className="sb-foot">
        <IdentityControl dark/>
        {onSweeps && sweeps.length > 1 && <button className="sb-item" onClick={onSweeps} style={{marginTop:8}}><Icon.swap/><span>My sweeps</span></button>}
        <div className="dt" style={{marginTop:12}}><b>{fmtDate(new Date())}</b></div>
      </div>
```

with:

```jsx
      <div className="sb-foot">
        <IdentityControl dark/>
        <SpoilerToggle/>
        {onSweeps && sweeps.length > 1 && <button className="sb-item" onClick={onSweeps} style={{marginTop:8}}><Icon.swap/><span>My sweeps</span></button>}
        <div className="dt" style={{marginTop:12}}><b>{fmtDate(new Date())}</b></div>
      </div>
```

In `web/src/desktop.css`, add a rule so the compact header toggle never doubles up with the Sidebar toggle on desktop (the Sidebar is outside `.deskscreen`, so it is unaffected). Add near the other `.deskscreen .page-top` rules (after line 65):

```css
  .deskscreen .spoiler-tog{ display:none; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- src/components.test.jsx -t "renders the spoiler toggle"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components.jsx web/src/desktop.css web/src/components.test.jsx
git commit -m "feat(web): expose spoiler toggle in sidebar and mobile headers"
```

---

## Task 8: Full verification + manual smoke + finish

**Files:** none (verification only)

- [ ] **Step 1: Run the full web suite**

Run: `npm run test`
Expected: PASS — all previous tests plus the new spoiler tests (store 6, components ~6, screens-detail 1, FloatingReactions 3). Confirm the count went up and nothing regressed.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev:web`, open the app, and verify by hand:
  - Toggle "Hide scores" on (mobile: top header eye; desktop: sidebar pill). Finished and live scores show the eye-off cover.
  - Tap a cover → that score reveals; other matches stay covered.
  - Reload the page → covers come back (reveals reset).
  - With mode on, a live match in the hero shows the cover but keeps its `LIVE` minute label.
  - Toggle off → all scores show, no covers.
  - (If a live match is in play) confirm goal/card popups do not appear while the match is covered, and do appear after you reveal it. If no live match is available, note this as not manually exercised (the unit tests in Task 6 cover it).

- [ ] **Step 4: Update CLAUDE.md notes if needed**

No env vars or commands changed — no CLAUDE.md update required. (Skip unless something surfaced during smoke.)

- [ ] **Step 5: Finish the branch**

Invoke the `superpowers:finishing-a-development-branch` skill to choose how to integrate `feat/spoiler-protection` (merge to `main` / open a PR). The spec and all tasks are committed; the suite is green.

---

## Self-Review

**Spec coverage:**
- Store (`sweep.spoiler.v1`, default OFF, in-memory reveal set, `isRevealed`, `spoilerHidden` covering final+live) → Task 1. ✓
- `Icon.eyeoff`, `<ScoreCover>` (stopPropagation, dark variant), `<SpoilerToggle>` → Task 2. ✓
- Enabling clears reveal set; reload resets → Task 1 tests + manual Step 3. ✓
- Seven score sites: MatchCard (T3), Latest scores + hero (T4), MatchSheet + PersonDetail + TeamDetail + gpk-meta (T5). ✓ (gpk-meta uses a static glyph because the picker button is itself the tap target — documented in T5.)
- Event-popup muting for `kind:"match"`, social reactions unaffected → Task 6. ✓
- Toggle in Sidebar (desktop) + HomeHeader & PageHeader (mobile), hidden on desktop in-screen to avoid duplication → Task 7. ✓
- Tests: store unit, component, screens-detail, FloatingReactions → Tasks 1-7. ✓

**Placeholder scan:** None — every code step carries complete, runnable code.

**Type/name consistency:** `isSpoiler`, `setSpoiler`, `reveal`, `isRevealed`, `spoilerHidden`, `useSpoiler` are named identically across `spoiler.js`, the wiring tasks, and tests. `components.jsx` imports `reveal` as `revealScore` (to avoid shadowing) and uses it only inside `ScoreCover`; all other files import `reveal` directly. `ScoreCover`/`SpoilerToggle` are exported from `components.jsx` and imported where used. `spoilerHidden(f)` is always called with a fixture object that has `id`, `status`, `score`. ✓
