# Google Analytics (GA4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add anonymous, production-only Google Analytics 4 (GA4) to the web app — SPA pageviews plus three custom events (`vote_cast`, `match_open`, `pwa_install`).

**Architecture:** A single in-repo wrapper module (`web/src/lib/analytics.js`) owns all contact with Google's `gtag.js`. It loads only in production builds (gated on `import.meta.env.PROD`) and is a silent no-op in dev and tests, so nothing reaches the network there. Three existing chokepoints call `trackEvent`; `App.jsx` calls `trackPageview` on every route change. No new npm dependency. The GA4 Measurement ID (`G-6PZ0DXRS2D`) is a public constant baked into source; an optional `VITE_GA_ID` env var overrides it.

**Tech Stack:** Vite 5, React 18, Vitest + Testing Library, Google `gtag.js` (loaded at runtime, no package).

**Spec:** `docs/superpowers/specs/2026-06-13-google-analytics-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `web/src/lib/analytics.js` | The only seam to Google. `initAnalytics` / `trackPageview` / `trackEvent`. Gating + safety live here. | **Create** |
| `web/src/lib/analytics.test.js` | Unit tests: gate is off in test env; forwarding + no-throw safety. | **Create** |
| `web/src/social.js` | `setSupport` (vote chokepoint) emits `vote_cast`. | Modify (`:56`) |
| `web/src/social.test.js` | Test that a *new* pick emits `vote_cast` with correct `pick`/`match_id`, and un-voting does not. | Modify |
| `web/src/hooks/useInstallPrompt.js` | `appinstalled` listener emits `pwa_install`. | Modify (`:39`) |
| `web/src/hooks/useInstallPrompt.test.jsx` | Test that an `appinstalled` event emits `pwa_install`. | Modify |
| `web/src/App.jsx` | Call `initAnalytics` once; emit a pageview on every `view` change; `openMatch` emits `match_open`. | Modify (`:4`, `:62-78`, `:81`) |
| `web/src/App.test.jsx` | Test mount init + pageviews (mount + popstate) + `match_open` on card click. | **Create** |
| `.env.example` | Document the optional `VITE_GA_ID` override. | Modify |
| `CLAUDE.md` | Add `VITE_GA_ID` to the env-vars table. | Modify |

---

## Task 1: Analytics wrapper module

**Files:**
- Create: `web/src/lib/analytics.js`
- Test: `web/src/lib/analytics.test.js`

The module is the only place that touches `gtag`. `initAnalytics` is gated on `import.meta.env.PROD`, so in the test environment (where `PROD` is `false`) it never injects a script or defines `window.gtag` — that is the key safety property we test. `trackPageview`/`trackEvent` simply forward to `window.gtag` if it exists (it only exists after a prod `initAnalytics`, or when a test stubs it), and swallow any error so analytics can never break the app.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/analytics.test.js`:

```js
import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { initAnalytics, trackPageview, trackEvent } from './analytics.js'

beforeEach(() => {
  delete window.gtag
  delete window.dataLayer
  document.head.querySelectorAll('script[src*="googletagmanager"]').forEach((s) => s.remove())
})
afterEach(() => { vi.restoreAllMocks() })

test('initAnalytics is a no-op in the test env (PROD is false): no gtag, no script', () => {
  initAnalytics()
  expect(window.gtag).toBeUndefined()
  expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull()
})

test('trackEvent forwards name + params to window.gtag when present', () => {
  window.gtag = vi.fn()
  trackEvent('vote_cast', { pick: 'home', match_id: 'm1' })
  expect(window.gtag).toHaveBeenCalledWith('event', 'vote_cast', { pick: 'home', match_id: 'm1' })
})

test('trackEvent is a silent no-op when gtag is absent', () => {
  expect(() => trackEvent('vote_cast', { pick: 'home' })).not.toThrow()
})

test('trackPageview forwards a page_view event with the path', () => {
  window.gtag = vi.fn()
  trackPageview('/schedule')
  expect(window.gtag).toHaveBeenCalledWith(
    'event',
    'page_view',
    expect.objectContaining({ page_path: '/schedule' }),
  )
})

test('trackPageview swallows a throwing gtag (never breaks the app)', () => {
  window.gtag = () => { throw new Error('boom') }
  expect(() => trackPageview('/x')).not.toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- analytics`
Expected: FAIL — `Failed to resolve import "./analytics.js"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/analytics.js`:

```js
/* ============================================================
   THE SWEEP — GA4 analytics. The ONLY contact with Google.
   Loads gtag.js in PRODUCTION BUILDS ONLY; a silent no-op in
   dev and tests, so nothing phones home there. A GA4 Measurement
   ID is public (visible in any GA page's HTML), so it lives in
   source as a default; VITE_GA_ID overrides it ("" disables).
   ============================================================ */

const ENV_ID = import.meta.env.VITE_GA_ID
const GA_ID = ENV_ID === undefined ? 'G-6PZ0DXRS2D' : ENV_ID

let initialized = false

export function initAnalytics() {
  if (initialized) return
  if (!import.meta.env.PROD || !GA_ID) return // dev/test/disabled → no network
  initialized = true

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() { window.dataLayer.push(arguments) }
  window.gtag('js', new Date())
  // send_page_view:false — this is an SPA; we emit pageviews ourselves on route change.
  window.gtag('config', GA_ID, { anonymize_ip: true, send_page_view: false })
}

export function trackPageview(path) {
  try {
    if (!window.gtag) return
    window.gtag('event', 'page_view', {
      page_path: path,
      page_location: window.location.origin + path,
      page_title: document.title,
    })
  } catch { /* analytics must never break the app */ }
}

export function trackEvent(name, params = {}) {
  try {
    if (!window.gtag) return
    window.gtag('event', name, params)
  } catch { /* analytics must never break the app */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- analytics`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/analytics.js web/src/lib/analytics.test.js
git commit -m "feat(web): add GA4 analytics wrapper (prod-only, no-op in dev/test)"
```

---

## Task 2: Emit `vote_cast` from the vote chokepoint

**Files:**
- Modify: `web/src/social.js:56` (`setSupport`)
- Test: `web/src/social.test.js`

`setSupport(mid, code)` toggles a pick: line 60 *deletes* it on a re-tap (un-vote) and otherwise *sets* it. We emit `vote_cast` **only when a pick is set**, not when removed. `pick` is derived from the fixture: `code === DRAW` → `"draw"`, `code === fixture.t1` → `"home"`, `code === fixture.t2` → `"away"`.

- [ ] **Step 1: Write the failing test**

In `web/src/social.test.js`, add the analytics mock near the top (beside the existing `vi.mock('./api/client.js', …)`):

```js
vi.mock('./lib/analytics.js', () => ({ trackEvent: vi.fn() }))
```

Add `trackEvent` to the analytics import and `setSweepData`/`assembleSweep` are already imported. Then append these tests (they seed a fixture so `SWEEP.fixture('m1')` resolves):

```js
import { trackEvent } from './lib/analytics.js'

function seedFixture() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0c0', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Andriy', short: 'Andriy', initials: 'A', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', ko: '2026-06-20T18:00:00Z', t1: 'hr', t2: 'br', status: 'upcoming', group: 'A', stage: 'group', prob: null, score: null }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
}

test('setSupport emits vote_cast with home/away/draw pick + match_id when a pick is set', () => {
  seedFixture()
  setMe('p1')
  setSupport('m1', 'hr') // hr === t1 → home
  expect(trackEvent).toHaveBeenCalledWith('vote_cast', { pick: 'home', match_id: 'm1' })

  setSupport('m1', 'br') // switch to t2 → away (replaces the pick)
  expect(trackEvent).toHaveBeenCalledWith('vote_cast', { pick: 'away', match_id: 'm1' })
})

test('setSupport does NOT emit vote_cast when a pick is removed (re-tap)', () => {
  seedFixture()
  setMe('p1')
  setSupport('m1', 'hr')      // set
  trackEvent.mockClear()
  setSupport('m1', 'hr')      // same code again → un-vote
  expect(trackEvent).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- social`
Expected: FAIL — `trackEvent` not called (no analytics wired into `setSupport` yet).

- [ ] **Step 3: Write minimal implementation**

In `web/src/social.js`, add the import beside the existing imports (after line 8):

```js
import { trackEvent } from "./lib/analytics.js";
```

Replace `setSupport` (lines 56–64) with:

```js
export function setSupport(mid, code){
  if (!meId){ if (window.__sweepPickMe) window.__sweepPickMe(); return; }
  const prev = support;
  const m = Object.assign({}, support[mid] || {});
  if (m[meId] === code) { delete m[meId]; }
  else {
    m[meId] = code;
    const f = S.fixture(mid);
    const pick = code === DRAW ? "draw" : (f && code === f.t1 ? "home" : "away");
    trackEvent("vote_cast", { pick, match_id: mid });
  }
  support = Object.assign({}, support, { [mid]: m });
  notifySocial();
  postSupport(mid, meId, code).catch(()=>{ support = prev; notifySocial(); toast("Couldn't update — try again"); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- social`
Expected: PASS (all existing social tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/social.js web/src/social.test.js
git commit -m "feat(web): emit vote_cast analytics event on a new crowd pick"
```

---

## Task 3: Emit `pwa_install` from the appinstalled listener

**Files:**
- Modify: `web/src/hooks/useInstallPrompt.js:39`
- Test: `web/src/hooks/useInstallPrompt.test.jsx`

The hook attaches an `appinstalled` window listener once at import time (`start()`, line 41). That is the truest install signal (fires on a real install via any path), so we emit `pwa_install` there.

- [ ] **Step 1: Write the failing test**

In `web/src/hooks/useInstallPrompt.test.jsx`, add the mock near the top imports:

```js
vi.mock('../lib/analytics.js', () => ({ trackEvent: vi.fn() }))
import { trackEvent } from '../lib/analytics.js'
```

Add this test:

```js
test('an appinstalled event emits the pwa_install analytics event', () => {
  trackEvent.mockClear()
  window.dispatchEvent(new Event('appinstalled'))
  expect(trackEvent).toHaveBeenCalledWith('pwa_install')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- useInstallPrompt`
Expected: FAIL — `trackEvent` not called (listener doesn't emit yet).

- [ ] **Step 3: Write minimal implementation**

In `web/src/hooks/useInstallPrompt.js`, add the import at the top of the file (after the existing imports near line 1):

```js
import { trackEvent } from '../lib/analytics.js'
```

Change the `appinstalled` listener on line 39 from:

```js
  window.addEventListener('appinstalled', () => { installedViaEvent = true; deferredEvt = null; emit() })
```

to:

```js
  window.addEventListener('appinstalled', () => { installedViaEvent = true; deferredEvt = null; trackEvent('pwa_install'); emit() })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- useInstallPrompt`
Expected: PASS (all existing install tests + 1 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useInstallPrompt.js web/src/hooks/useInstallPrompt.test.jsx
git commit -m "feat(web): emit pwa_install analytics event on appinstalled"
```

---

## Task 4: Pageviews + init in the app shell

**Files:**
- Modify: `web/src/App.jsx` (import at `:4-19`; mount effect at `:62-78`)
- Create: `web/src/App.test.jsx`

Call `initAnalytics()` once in the existing mount `useEffect`, and add a second `useEffect` keyed on `view` that emits `trackPageview(urlFor(view))`. Because both `navigate()` and the `popstate` handler update `view`, this captures forward navigation and browser back/forward with no extra wiring. `urlFor` already exists in the file.

- [ ] **Step 1: Write the failing test**

Create `web/src/App.test.jsx`:

```js
import { expect, test, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('./lib/analytics.js', () => ({
  initAnalytics: vi.fn(), trackPageview: vi.fn(), trackEvent: vi.fn(),
}))
vi.mock('./api/client.js', () => ({ postWatch: vi.fn(async () => ({})), postSupport: vi.fn(async () => ({})) }))
vi.mock('./hooks/useEventStream.js', () => ({ useEventStream: vi.fn() }))
vi.mock('./admin.js', () => ({ refreshAdminBadge: vi.fn() }))

import App from './App.jsx'
import { initAnalytics, trackPageview } from './lib/analytics.js'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'

beforeEach(() => {
  localStorage.clear(); setMe(null); vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0c0', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', ko: '2026-06-20T18:00:00Z', t1: 'hr', t2: 'br', status: 'upcoming', group: 'A', stage: 'group', prob: null, score: null }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
})

test('mounts analytics and emits a pageview for the initial route', () => {
  render(<App />)
  expect(initAnalytics).toHaveBeenCalledTimes(1)
  expect(trackPageview).toHaveBeenCalledWith('/')
})

test('emits a pageview when the view changes (popstate navigation)', () => {
  render(<App />)
  trackPageview.mockClear()
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { tab: 'schedule', overlay: null, modal: null, identity: false },
    }))
  })
  expect(trackPageview).toHaveBeenCalledWith('/schedule')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- App`
Expected: FAIL — `initAnalytics`/`trackPageview` not called (not wired into `App` yet).

- [ ] **Step 3: Write minimal implementation**

In `web/src/App.jsx`, add the analytics import after the existing imports (after line 19):

```js
import { initAnalytics, trackPageview } from "./lib/analytics.js";
```

Inside the mount `useEffect` (the one starting near line 62 that calls `setGlobalToast(showToast)`), add `initAnalytics();` as its first line:

```js
  useEffect(() => {
    initAnalytics();
    setGlobalToast(showToast);
```

Then, immediately after that mount `useEffect` block (after its closing `}, []);`), add a second effect:

```js
  // SPA pageview: every view change (forward nav + popstate) is one virtual page.
  useEffect(() => { trackPageview(urlFor(view)); }, [view]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- App`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/App.jsx web/src/App.test.jsx
git commit -m "feat(web): init GA4 and emit SPA pageviews on route change"
```

---

## Task 5: Emit `match_open` when the match sheet opens

**Files:**
- Modify: `web/src/App.jsx:81` (`openMatch`)
- Modify: `web/src/App.test.jsx`

`openMatch(f)` is the single place the match modal is created. Emit `match_open` there. The test drives the real path: navigate to the schedule tab (which lists every fixture as a `MatchCard` whose root is `<article class="card">`), click the card, and assert the event.

- [ ] **Step 1: Write the failing test**

Append to `web/src/App.test.jsx` (the `trackEvent` mock already exists from Task 4's `vi.mock('./lib/analytics.js', …)`; add it to the import):

```js
import { trackEvent } from './lib/analytics.js'

test('emits match_open when a match card is opened', () => {
  const { container } = render(<App />)
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { tab: 'schedule', overlay: null, modal: null, identity: false },
    }))
  })
  const card = container.querySelector('.card')
  expect(card).not.toBeNull()
  act(() => { card.click() })
  expect(trackEvent).toHaveBeenCalledWith('match_open', { match_id: 'm1' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- App`
Expected: FAIL — `trackEvent('match_open', …)` not called (not wired yet).

- [ ] **Step 3: Write minimal implementation**

In `web/src/App.jsx`, change `openMatch` on line 81 from:

```js
  const openMatch  = (f) => navigate({ modal: { type: "match", id: f.id } });
```

to:

```js
  const openMatch  = (f) => { trackEvent("match_open", { match_id: f.id }); navigate({ modal: { type: "match", id: f.id } }); };
```

Add `trackEvent` to the analytics import at the top of the file (the line added in Task 4):

```js
import { initAnalytics, trackPageview, trackEvent } from "./lib/analytics.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- App`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/App.jsx web/src/App.test.jsx
git commit -m "feat(web): emit match_open analytics event when a match sheet opens"
```

---

## Task 6: Document the optional override

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

No build-env change is needed (the ID is baked in), but document the optional `VITE_GA_ID` override so it's discoverable.

- [ ] **Step 1: Add the env-example entry**

In `.env.example`, append at the end:

```bash

# Web — Google Analytics 4. The Measurement ID is baked into web/src/lib/analytics.js
# (a GA4 ID is public) and loads in PRODUCTION builds only. Optional overrides below:
#   VITE_GA_ID=G-XXXXXXXXXX   # point a build at a different GA4 property
#   VITE_GA_ID=               # empty string disables analytics in a prod build
```

- [ ] **Step 2: Add a row to the CLAUDE.md env table**

In `CLAUDE.md`, in the env-vars table (the `| Var | Phase | Notes |` table), add a row after the `SITE_ORIGIN` row:

```markdown
| `VITE_GA_ID` | — | Optional. Overrides the baked-in GA4 Measurement ID for the web build; empty string disables analytics. Prod-only by default. |
```

- [ ] **Step 3: Verify the full suite and production build are green**

Run: `npm test -w web && npm run build -w web`
Expected: all web tests PASS; `vite build` completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document optional VITE_GA_ID analytics override"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** wrapper module (Task 1), pageviews + init (Task 4), `vote_cast` (Task 2), `match_open` (Task 5), `pwa_install` (Task 3), anonymous/no-banner (Task 1 config: `anonymize_ip`, no identity), prod-only gate (Task 1), baked ID + optional `VITE_GA_ID` (Tasks 1 & 6). Photo-upload event intentionally absent (dropped in spec).
- **Naming consistency:** `initAnalytics` / `trackPageview` / `trackEvent` used identically across Tasks 1, 2, 3, 4, 5. Event names `vote_cast` / `match_open` / `pwa_install` and the `pick` mapping (`home`/`draw`/`away`) are consistent throughout.
- **No identity:** events carry only `pick` and `match_id`; no person id/name is ever sent.
- **Manual human step (outside code):** in the GA4 stream, add both `sweep.andriycherednikov.com` and `sweep.yowiebay.au` under *Configure tag settings → Configure your domains* so cross-domain visits aren't double-counted.
