# Wagers self-exclusion ("opt out") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the privacy "eye" in the Wagers header with a binding self-exclusion ("opt out") control — opt out for 1/3/7/14 days or completely; while opted out the whole Yowie Dollars / Wagers feature is hidden exactly like a minor account, with no early opt-back-in and the remaining time never displayed.

**Architecture:** Frontend only. A new device-local store `web/src/optout.js` (mirrors `web/src/spoiler.js`: localStorage flag + listeners Set + reactive hook) feeds one extra clause into the existing `canWager()` gate in `coins.js`. Everything already keyed off `canWager()` (nav tab, coins screen, People/profile Yowie Dollars) inherits the hide for free. A new `OptOutButton` + opt-out sheet replace the eye in the Wagers header and are also reachable via a shield in the "?" About-Wagers sheet.

**Tech Stack:** Vite + React 18, Vitest + @testing-library/react. No API/DB changes.

**Reference spec:** `docs/superpowers/specs/2026-06-19-wagers-opt-out-design.md`

---

## File Structure

- **Create** `web/src/optout.js` — single source of truth for opt-out state (`isOptedOut`, `optOut`, `useOptOut`, `OPT_OUT_DAYS`).
- **Create** `web/src/optout.test.js` — unit tests for the store.
- **Modify** `web/src/coins.js` — add `!isOptedOut()` to `canWager()`.
- **Modify** `web/src/coins.test.js` — cover the gated `canWager()`.
- **Modify** `web/src/components.jsx` — add `shield` Icon; add `OptOutButton`; add `replaceSpoiler` prop to `AppHeader`; subscribe `BottomNav` + `Sidebar` to `useOptOut()`.
- **Modify** `web/src/components.test.jsx` — cover the nav hide + header swap.
- **Modify** `web/src/App.jsx` — subscribe the App body to `useOptOut()` so the coins screen unmounts on opt-out.
- **Modify** `web/src/screens-coins.jsx` — `OptOutSheet`; wire it into `CoinsScreen` (header shield + state) and `WalletHeader` (desktop); add the "Stepping away" section + shield to `WagersInfoSheet`.
- **Modify** `web/src/screens-coins.test.jsx` — cover the opt-out flow.

---

## Task 1: The opt-out store (`optout.js`)

**Files:**
- Create: `web/src/optout.js`
- Test: `web/src/optout.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/src/optout.test.js`:

```js
import { expect, test, beforeEach } from 'vitest'
import { isOptedOut, optOut, OPT_OUT_DAYS } from './optout.js'

beforeEach(() => {
  localStorage.clear()
})

test('not opted out by default', () => {
  expect(isOptedOut()).toBe(false)
})

test('optOut(7d) opts out and stores a future expiry roughly 7 days out', () => {
  const before = Date.now()
  optOut('7d')
  expect(isOptedOut()).toBe(true)
  const raw = Number(localStorage.getItem('sweep.wagers.optout.v1'))
  const sevenDays = OPT_OUT_DAYS['7d'] * 86_400_000
  expect(raw).toBeGreaterThanOrEqual(before + sevenDays - 1000)
  expect(raw).toBeLessThanOrEqual(Date.now() + sevenDays + 1000)
})

test('an expired timestamp reads as not opted out (silent lift)', () => {
  localStorage.setItem('sweep.wagers.optout.v1', String(Date.now() - 1000))
  expect(isOptedOut()).toBe(false)
})

test('optOut(forever) is opted out indefinitely', () => {
  optOut('forever')
  expect(localStorage.getItem('sweep.wagers.optout.v1')).toBe('forever')
  expect(isOptedOut()).toBe(true)
})

test('an unknown duration key is ignored (no lockout)', () => {
  optOut('bogus')
  expect(isOptedOut()).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- optout.test.js`
Expected: FAIL — "Failed to resolve import './optout.js'".

- [ ] **Step 3: Write minimal implementation**

Create `web/src/optout.js`:

```js
// web/src/optout.js
// Device-local Wagers self-exclusion ("opt out"). Binding for the chosen period:
// no early reversal, and the remaining time is never surfaced. Mirrors the
// localStorage-backed module-store pattern in spoiler.js (flag + listeners + hook).
import { useState, useEffect } from 'react'

const KEY = 'sweep.wagers.optout.v1'
const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

// days per duration key; 'forever' is special-cased (indefinite, no auto-return)
export const OPT_OUT_DAYS = { '1d': 1, '3d': 3, '7d': 7, '14d': 14 }

// In-memory mirror so it still works in-session when localStorage is unavailable
// (private mode). localStorage is the source of truth when readable.
let mem = null // null = not opted out; 'forever'; or an epoch-ms expiry string
function read() {
  try { return localStorage.getItem(KEY) } catch { return mem }
}

/** @returns {boolean} whether Wagers is currently locked out on this device */
export function isOptedOut() {
  const v = read()
  if (!v) return false
  if (v === 'forever') return true
  return Number(v) > Date.now()
}

/** Opt out for a duration key (∈ keys of OPT_OUT_DAYS, or 'forever'). Binding. */
export function optOut(durationKey) {
  let v
  if (durationKey === 'forever') v = 'forever'
  else if (OPT_OUT_DAYS[durationKey]) v = String(Date.now() + OPT_OUT_DAYS[durationKey] * 86_400_000)
  else return // unknown key: ignore, never lock out on a typo
  mem = v
  try { localStorage.setItem(KEY, v) } catch { /* private mode — mem holds it */ }
  notify()
}

/** Reactive hook — re-renders the caller when the opt-out state changes. */
export function useOptOut() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((x) => x + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
  return { optedOut: isOptedOut() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- optout.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/optout.js web/src/optout.test.js
git commit -m "feat(web): device-local Wagers opt-out store"
```

---

## Task 2: Gate `canWager()` on opt-out

**Files:**
- Modify: `web/src/coins.js` (import + `canWager`, lines ~1-27)
- Test: `web/src/coins.test.js`

- [ ] **Step 1: Write the failing test**

In `web/src/coins.test.js`, add `localStorage.clear()` to the top of the existing `beforeEach` (so opt-out state never leaks between tests):

```js
beforeEach(() => {
  localStorage.clear()
  S.people = [{ id: 'pn_a', name: 'Ann' }, { id: 'pn_b', name: 'Bob' }]
  // ...rest unchanged...
```

Update the import line to add `canWager`, and import `optOut`:

```js
import { setWalletData, myBalance, placeBet, coinsLeaderboard, balanceByPerson, canWager } from './coins.js'
import { optOut } from './optout.js'
```

Add this test:

```js
test('canWager is false while opted out, true once the window lapses', () => {
  expect(canWager()).toBe(true)   // me = pn_a, an adult
  optOut('1d')
  expect(canWager()).toBe(false)
  localStorage.clear()            // simulate the window elapsing / silent lift
  expect(canWager()).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- coins.test.js`
Expected: FAIL — `canWager()` returns `true` after `optOut('1d')` (gate not wired yet).

- [ ] **Step 3: Write minimal implementation**

In `web/src/coins.js`, add the import near the top (after the existing imports):

```js
import { isOptedOut } from './optout.js'
```

Change `canWager` (currently line ~27) to:

```js
export function canWager() { const me = getMe(); return !!me && me.adult !== false && !isOptedOut() }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- coins.test.js`
Expected: PASS (all coins tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add web/src/coins.js web/src/coins.test.js
git commit -m "feat(web): hide Wagers while opted out (canWager gate)"
```

---

## Task 3: `shield` Icon, `OptOutButton`, `replaceSpoiler` header prop, nav re-render

**Files:**
- Modify: `web/src/components.jsx` (Icon block ~38-60; `SpoilerToggle` region ~96-118; `AppHeader` ~336-390; `BottomNav` ~443; `Sidebar` ~502)
- Test: `web/src/components.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/components.test.jsx`, ensure these imports exist at the top (add what's missing):

```js
import { BottomNav, OptOutButton } from './components.jsx'
import { setMe } from './social.js'
import { optOut } from './optout.js'
```

Add this block:

```js
test('BottomNav hides the Wagers tab once opted out', () => {
  localStorage.clear()
  setMe('pn_a') // an adult (no adult:false)
  const { queryByText, rerender } = render(<BottomNav tab="home" go={() => {}} />)
  expect(queryByText('Wagers')).toBeInTheDocument()
  optOut('7d')
  rerender(<BottomNav tab="home" go={() => {}} />)
  expect(queryByText('Wagers')).not.toBeInTheDocument()
})

test('OptOutButton renders a shield and fires onClick', () => {
  const onClick = vi.fn()
  const { getByLabelText } = render(<OptOutButton onClick={onClick} />)
  fireEvent.click(getByLabelText('Step away from Wagers'))
  expect(onClick).toHaveBeenCalled()
})
```

Make sure `S.people` includes `pn_a` as an adult in this test file's setup. If `components.test.jsx` has no shared `S.people`, add to the top of the new `BottomNav` test: `S.people = [{ id: 'pn_a', name: 'Ann' }]` (import `SWEEP as S` from `./data.js` if not already imported). Confirm `vi` and `fireEvent` are imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- components.test.jsx`
Expected: FAIL — `OptOutButton` is not exported; and the BottomNav still shows "Wagers" after opt-out (no `useOptOut` subscription).

- [ ] **Step 3: Write minimal implementation**

**3a.** Add a `shield` entry to the `Icon` object in `components.jsx` (alongside the others, e.g. after `eyefill`):

```js
  shield:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...p}><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/></svg>,
```

**3b.** Add the `useOptOut` import near the top of `components.jsx` (with the other local imports, e.g. next to the `canWager` import):

```js
import { useOptOut } from "./optout.js";
```

**3c.** Add `OptOutButton` right after `SpoilerToggle` (around line 118):

```js
/* Wagers self-exclusion entry point — a discreet round shield button that opens
   the opt-out sheet (CoinsScreen owns that sheet). Replaces the privacy eye in the
   Wagers header only; not an eye, to read as self-care rather than spoiler control. */
export function OptOutButton({ onClick }) {
  return (
    <button type="button" onClick={onClick}
      aria-label="Step away from Wagers" title="Step away from Wagers"
      style={{width:30,height:30,borderRadius:9,background:"rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}>
      <Icon.shield style={{width:15,height:15,stroke:"#9fb6d6"}}/>
    </button>
  );
}
```

**3d.** Add a `replaceSpoiler` prop to `AppHeader`. Change the signature (line ~336):

```js
export function AppHeader({ home, title, sub, coins, right, onAdmin, go, onSweeps, scrolled, scrollRef, onBack, replaceSpoiler }) {
```

Replace the `<SpoilerToggle compact/>` line inside `AppHeader` (line ~373) with:

```js
          {replaceSpoiler != null ? replaceSpoiler : <SpoilerToggle compact/>}
```

**3e.** Subscribe `BottomNav` to opt-out changes — add `useOptOut();` right after the existing `useSocial();` (line ~444):

```js
export function BottomNav({ tab, go }) {
  useSocial(); // re-render on identity change so the Wagers tab appears/hides
  useOptOut(); // ...and on opt-out, so the tab disappears immediately
  const tabs = TABS.filter(([id]) => id !== "coins" || canWager());
```

**3f.** Subscribe `Sidebar` the same way — add `useOptOut();` right after its `useSocial();` (line ~501):

```js
  useSocial(); // re-render on identity change so the Wagers item appears/hides
  useOptOut(); // ...and on opt-out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- components.test.jsx`
Expected: PASS (both new tests + existing).

- [ ] **Step 5: Commit**

```bash
git add web/src/components.jsx web/src/components.test.jsx
git commit -m "feat(web): shield OptOutButton, replaceSpoiler header slot, nav re-render on opt-out"
```

---

## Task 4: App-body re-render on opt-out

**Files:**
- Modify: `web/src/App.jsx` (imports near top; App body ~102)

No new test — covered end-to-end by Task 6's screen test (opting out unmounts the coins screen). This task only ensures the top-level layout reacts.

- [ ] **Step 1: Add the import**

In `web/src/App.jsx`, near the `import { canWager } from "./coins.js";` line, add:

```js
import { useOptOut } from "./optout.js";
```

- [ ] **Step 2: Subscribe the App body**

Right after `useSocial(); // re-render on identity change (gates the 18+ Wagers screen)` (line ~102), add:

```js
  useOptOut(); // re-render on opt-out so the coins tab falls back to Home immediately
```

- [ ] **Step 3: Verify the suite still builds/passes**

Run: `npm test -w web`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add web/src/App.jsx
git commit -m "feat(web): App re-renders on opt-out so Wagers falls back to Home"
```

---

## Task 5: The opt-out sheet + wiring into the Wagers screen

**Files:**
- Modify: `web/src/screens-coins.jsx` (import ~8; `WalletHeader` ~122-153; `CoinsScreen` ~343-513)
- Test: `web/src/screens-coins.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/screens-coins.test.jsx`, import `optOut` is **not** needed; add this test (uses the existing `beforeEach` which sets `me = pn_a`, an adult). Add `localStorage.clear()` as the first line of the existing `beforeEach` so prior opt-outs don't leak:

```js
beforeEach(() => {
  localStorage.clear()
  // ...rest unchanged...
```

New test:

```js
test('the header shield opens the opt-out sheet and a duration locks Wagers', () => {
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  // shield replaces the privacy eye in the Wagers header
  fireEvent.click(screen.getByLabelText('Step away from Wagers'))
  // sheet shows the five choices
  expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Completely' })).toBeInTheDocument()
  // choosing a duration reveals the confirm step
  fireEvent.click(screen.getByRole('button', { name: '7 days' }))
  const confirm = screen.getByRole('button', { name: /^confirm$/i })
  fireEvent.click(confirm)
  // opted out → canWager() is now false
  expect(require('./coins.js').canWager()).toBe(false)
})
```

(If the file is ESM-only and `require` is unavailable, instead `import { canWager } from './coins.js'` at the top and assert `expect(canWager()).toBe(false)`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- screens-coins.test.jsx`
Expected: FAIL — no element labelled "Step away from Wagers" (shield not wired yet).

- [ ] **Step 3: Write minimal implementation**

**3a.** Update the import in `screens-coins.jsx` (line ~8) to pull in `OptOutButton`:

```js
import { Icon, Flag, useScrolled, useIsDesktop, AppHeader, OptOutButton } from './components.jsx'
```

Add an opt-out store import (line ~10 area):

```js
import { optOut, OPT_OUT_DAYS } from './optout.js'
```

**3b.** Add the `OptOutSheet` component. Place it just above `WagersInfoSheet` (around line 296):

```js
/* Wagers self-exclusion sheet. Two steps — choose a duration, then confirm —
   because the choice is BINDING: once confirmed there's no early opt-back-in and
   the remaining time is never shown. Reachable from the header shield and from the
   "Stepping away" section of the About sheet. */
const OPT_OUT_CHOICES = [
  ['1d', '1 day'],
  ['3d', '3 days'],
  ['7d', '7 days'],
  ['14d', '14 days'],
  ['forever', 'Completely'],
]
export function OptOutSheet({ onClose }) {
  const [chosen, setChosen] = useState(null) // duration key awaiting confirmation
  const label = OPT_OUT_CHOICES.find(([k]) => k === chosen)?.[1]
  const confirmCopy = chosen === 'forever'
    ? "You're stepping away from Wagers for good. It won't turn itself back on."
    : `You're stepping away from Wagers for ${label}. It'll lock now and quietly come back when the time's up — you can't turn it back on early.`
  function confirm() { optOut(chosen); onClose() }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '92%' }}>
        <div className="grab" />
        <div className="sheet-head">
          <h3>Step away from Wagers</h3>
          <button className="x" onClick={onClose}><Icon.x /></button>
        </div>
        <div className="sheet-body">
          {chosen == null ? (
            <>
              <p className="fyi-lead">
                Taking a break is completely OK — and completely anonymous. Choose how long to
                step away. Wagers will be hidden until then; there's no turning it back on early.
              </p>
              <div className="optout-choices">
                {OPT_OUT_CHOICES.map(([k, lbl]) => (
                  <button key={k} className="optout-choice" onClick={() => setChosen(k)}>{lbl}</button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="fyi-lead">{confirmCopy}</p>
              <div className="optout-confirm-row">
                <button className="btn-ghost" onClick={() => setChosen(null)}>Cancel</button>
                <button className="cta" onClick={confirm}>Confirm</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

**3c.** Wire it into `CoinsScreen`. Add an `optOutOpen` state next to the existing `info` state (line ~350):

```js
  const [info, setInfo] = useState(false)
  const [optOutOpen, setOptOutOpen] = useState(false)
```

Pass the shield into the mobile header via `replaceSpoiler` (line ~388). Change:

```js
        : <AppHeader title="Wagers" coins={wallet.balance} go={go} scrolled={scrolled} right={helpBtn}
            replaceSpoiler={<OptOutButton onClick={() => setOptOutOpen(true)} />} />}
```

Render the sheet alongside the others (near the `{info && <WagersInfoSheet .../>}` line, ~512):

```js
      {optOutOpen && <OptOutSheet onClose={() => setOptOutOpen(false)} />}
```

**3d.** Wire the desktop `WalletHeader` shield. In `WalletHeader` (line ~148), the `onInfo` "?" button is rendered. Add an `onOptOut` prop to the signature and render the shield next to it:

Change the signature (line ~122):

```js
export function WalletHeader({ onBack, go, scrolled, onInfo, onOptOut }) {
```

Replace the `{onInfo && ...}` line (line ~148) with:

```js
        {onOptOut && <OptOutButton onClick={onOptOut} />}
        {onInfo && <button className="hdr-help coin-help" onClick={onInfo} aria-label="About wagers" title="About wagers">?</button>}
```

And pass `onOptOut` where `WalletHeader` is used in `CoinsScreen` (line ~387):

```js
        ? <WalletHeader onInfo={() => setInfo(true)} onOptOut={() => setOptOutOpen(true)} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- screens-coins.test.jsx`
Expected: PASS (the new flow test + existing 4).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-coins.jsx web/src/screens-coins.test.jsx
git commit -m "feat(web): opt-out sheet wired into the Wagers header (mobile + desktop)"
```

---

## Task 6: "Stepping away" section + shield in the About-Wagers sheet

**Files:**
- Modify: `web/src/screens-coins.jsx` (`WagersInfoSheet` ~296-340; `CoinsScreen` ~361 and ~512)
- Test: `web/src/screens-coins.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/screens-coins.test.jsx`, add:

```js
test('the About sheet shield hands off to the opt-out sheet', () => {
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  // open the "?" About sheet
  fireEvent.click(screen.getByRole('button', { name: /about wagers/i }))
  expect(screen.getByText(/Stepping away is OK/i)).toBeInTheDocument()
  // its shield opens the opt-out sheet
  fireEvent.click(screen.getByRole('button', { name: /step away from wagers/i }))
  expect(screen.getByRole('button', { name: 'Completely' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- screens-coins.test.jsx`
Expected: FAIL — no "Stepping away is OK" text in the About sheet yet.

- [ ] **Step 3: Write minimal implementation**

**3a.** Give `WagersInfoSheet` an `onOptOut` callback. Change its signature (line ~296):

```js
export function WagersInfoSheet({ onClose, onOptOut }) {
```

Add the "Stepping away" section inside `.sheet-body`, right before the `<div className="fyi-faq">` block (line ~329):

```js
          <div className="fyi-stepaway">
            <p>
              <b>Stepping away is OK.</b> Everyone's different. If you'd rather not take part — or if
              this feature could be harmful or a trigger for you — you absolutely should step away,
              and we 100% support that. It's completely anonymous: no one can see that you did it.
              You're free, welcome, and encouraged to do it any time it feels right for you.
            </p>
            <button className="btn-ghost fyi-stepaway-btn" onClick={onOptOut}>
              <Icon.shield style={{ width: 16, height: 16 }} /> Step away from Wagers
            </button>
          </div>
```

**3b.** Hand off from the About sheet to the opt-out sheet in `CoinsScreen`. Update the `WagersInfoSheet` render (line ~512) to pass `onOptOut` that closes the info sheet and opens the opt-out sheet:

```js
      {info && <WagersInfoSheet onClose={() => setInfo(false)} onOptOut={() => { setInfo(false); setOptOutOpen(true) }} />}
```

(Note: the button uses `aria-label`-free text "Step away from Wagers"; the test matches it by accessible name from its text content. The header `OptOutButton` uses the same accessible name via `aria-label` — both resolve under `name: /step away from wagers/i`. In the About-sheet test the header shield is also present, so scope the query: if the test fails on multiple matches, use `screen.getAllByRole('button', { name: /step away from wagers/i })` and click the last one, which is the in-sheet button.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- screens-coins.test.jsx`
Expected: PASS. If the "step away" query matches two buttons (header + sheet), switch that line to:

```js
  const btns = screen.getAllByRole('button', { name: /step away from wagers/i })
  fireEvent.click(btns[btns.length - 1])
```

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-coins.jsx web/src/screens-coins.test.jsx
git commit -m "feat(web): About-Wagers 'Stepping away' section opens the opt-out sheet"
```

---

## Task 7: Styles for the opt-out sheet + full verification

**Files:**
- Modify: `web/src/styles.css` (append a small block near the other `.fyi-*` / sheet styles)

- [ ] **Step 1: Add styles**

Append to `web/src/styles.css` (find the `.fyi-` rules and add nearby for cohesion):

```css
/* Wagers opt-out (self-exclusion) sheet */
.optout-choices { display: grid; gap: 8px; margin-top: 14px; }
.optout-choice {
  width: 100%; padding: 13px 14px; border-radius: 12px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  color: var(--ink); font-size: 15px; font-weight: 600; text-align: left; cursor: pointer;
}
.optout-choice:active { background: rgba(255,255,255,.12); }
.optout-confirm-row { display: flex; gap: 10px; margin-top: 16px; }
.optout-confirm-row .cta, .optout-confirm-row .btn-ghost { flex: 1; }
.fyi-stepaway {
  margin-top: 14px; padding: 12px 14px; border-radius: 12px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
}
.fyi-stepaway p { margin: 0 0 10px; font-size: 13px; line-height: 1.5; color: var(--muted); }
.fyi-stepaway-btn { display: inline-flex; align-items: center; gap: 7px; }
```

If `--ink`, `--muted`, or a `.btn-ghost` class don't exist, substitute the nearest existing tokens/classes used by the surrounding sheet styles (grep `styles.css` for `.fyi-lead` and `.btn-ghost`). Do not invent new design tokens.

- [ ] **Step 2: Run the full suite + build (the handoff gate)**

Run: `npm test -w web && npm run build`
Expected: all web tests PASS; production build succeeds.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run: `npm run dev:web`, open the Wagers tab:
- Shield (not eye) shows in the header. Tap → sheet → pick "7 days" → Confirm → Wagers tab disappears, screen falls back to Home, and no Yowie Dollars show on People/profiles.
- Re-open is impossible (the tab is gone) — confirming the hard lockout.
- The "?" sheet's "Stepping away" shield opens the same flow.

- [ ] **Step 4: Commit**

```bash
git add web/src/styles.css
git commit -m "style(web): opt-out sheet + 'Stepping away' styling"
```

---

## Self-Review notes (coverage map)

- Spec §1 store → Task 1. §2 gate → Task 2. §3 control (shield/button/header slot, re-render) → Tasks 3-5. §4 About-sheet handoff → Task 6. Styling → Task 7.
- "Completely" = `optOut('forever')` (Task 1) with explicit confirm copy (Task 5). No `optBackIn` / no clear export anywhere — hard lockout preserved.
- Remaining time never rendered: no task displays the expiry; `isOptedOut()` returns only a boolean.
- Anonymity / local-only: no API client calls, no server fields — confirm no `postX` import is added in any task.
