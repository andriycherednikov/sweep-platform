# Wagers self-exclusion ("opt out") — design

**Date:** 2026-06-19
**Status:** Approved, ready for implementation plan
**Surface:** `web/` (frontend only — no API/DB changes)

## Summary

Replace the red privacy "eye" in the **Wagers** screen header with an **opt-out**
control that lets a person self-exclude from the Yowie Dollars / Wagers feature for a
chosen period — **1 day, 3 days, 7 days, 14 days, or completely**.

This is a **self-exclusion** model, not a toggle. Once a person opts out:

- They lose all access to Wagers and Yowie Dollars **exactly like a minor account**:
  the Wagers nav tab disappears, the coins screen falls back to Home, the People
  "Yowie Dollars" view and the profile/detail Yowie Dollars stats are hidden.
- It is a **hard lockout**: there is **no early opt-back-in**. The chosen period is
  binding. The feature returns **silently** when the period expires.
- The remaining time is **never displayed anywhere**. No countdown, no "back on X".
- It is **device-local and fully anonymous**: nothing is sent to the server, nothing
  is visible to admins or other participants. No one can tell, visually or otherwise,
  that a person has opted out.

"Completely" means **indefinite on this device** — it never returns on its own and
there is no in-app way back, by design (consistent with hard-lockout + never-display
philosophy). The confirm copy says this plainly.

## Rationale

Wagering mechanics — even play-money ones — can be harmful or triggering for some
people. Responsible-gambling practice provides a real, binding self-exclusion that the
user cannot reverse in a moment of impulse. We mirror that: supportive, encouraged,
anonymous, and genuinely binding for the period chosen.

## Architecture

Frontend only. Mirrors the existing device-local store pattern in
`web/src/spoiler.js` / `web/src/sweeps.js` (localStorage-backed flag, a `listeners`
Set, a `notify()`, and a reactive hook).

### 1. New module: `web/src/optout.js`

Single source of truth for the opt-out state.

- **Storage key:** `sweep.wagers.optout.v1`.
- **Stored value:** an expiry **epoch-ms timestamp** (number serialized as string),
  or the literal string `"forever"`. Absent key ⇒ not opted out.
- **In-memory mirror** (`mem`) so it still works in-session when localStorage is
  unavailable (private mode), mirroring `spoiler.js`.

```
DURATIONS = { '1d': 1, '3d': 3, '7d': 7, '14d': 14 }   // days; 'forever' is special

isOptedOut(): boolean
  - read value; if missing → false
  - if value === 'forever' → true
  - if Number(value) > Date.now() → true
  - otherwise (expired) → false   // silent lift; no UI, key may be lazily cleared

optOut(durationKey):              // durationKey ∈ {'1d','3d','7d','14d','forever'}
  - 'forever' → write 'forever'
  - else → write String(Date.now() + days * 86_400_000)
  - notify()
  // NO optBackIn / clear export — early reversal is deliberately impossible

useOptOut(): { optedOut }         // reactive hook, re-renders subscribers on notify()
```

No timer is needed to "restore" access: `isOptedOut()` is read lazily on every render,
so the lock lifts on the next render after expiry (next navigation, re-render, or app
load). This is acceptable given the period granularity is days and the timeout is never
surfaced.

### 2. The gate — `web/src/coins.js`

One line changes. `canWager()`:

```
// before
export function canWager() { const me = getMe(); return !!me && me.adult !== false }
// after
import { isOptedOut } from './optout.js'
export function canWager() { const me = getMe(); return !!me && me.adult !== false && !isOptedOut() }
```

Everything already keyed off `canWager()` inherits the behavior with no further change:

- `components.jsx` `Nav` (line ~445) and `Sidebar` (~502) — Wagers tab/item filtered out.
- `App.jsx` (~141) — coins tab falls back to `HomeScreen`.
- `screens-main.jsx` (~92) — Wagers leaderboard view gated.
- `screens-detail.jsx` (~35,151) — Yowie Dollars People view + profile stat gated.

**Re-render on flip:** add a `useOptOut()` subscription to the components that gate so
the change is reflected instantly without a reload — `Nav`, `Sidebar`
(`components.jsx`), and the App body component (`App.jsx`). This mirrors how those
components already call `useSocial()` to react to identity changes.

### 3. The control — `OptOutButton` + opt-out sheet

Replaces the spoiler eye in the **Wagers header only**. Score-privacy is irrelevant on
the Wagers screen (it shows odds/upcoming matches, not scores), so nothing is lost.

- **`AppHeader`** (`components.jsx`) gains a `replaceSpoiler` prop. When provided, it
  renders that node **instead of** `<SpoilerToggle compact/>`. All other screens are
  unaffected and keep the eye.
- **`CoinsScreen`** (`screens-coins.jsx`, mobile path) passes
  `replaceSpoiler={<OptOutButton/>}` to `AppHeader`.
- **`WalletHeader`** (`screens-coins.jsx`, desktop path) renders `<OptOutButton/>`
  alongside the existing "?" help button.
- **Icon:** a discreet round icon button, **not** an eye — a shield (protection /
  self-care framing). `aria-label="Step away from Wagers"`.

The opt-out **sheet** is a `CoinsScreen`-owned component (like `betSheet` / `info`),
driven by a new `optOut` UI-state flag. `OptOutButton` (header) and the shield button
inside `WagersInfoSheet` (§4) both just flip that flag open — so the same sheet is
reachable from both entry points.

**Interaction (two-step, to prevent an accidental binding lockout):**

1. Open the **opt-out sheet** (from the header shield, or the in-explainer shield) —
   same sheet styling as `WagersInfoSheet`: supportive intro copy, then five choices —
   `1 day`, `3 days`,
   `7 days`, `14 days`, `Completely`.
2. Choosing a duration moves to a **confirm step**:
   - timed: *"You're stepping away from Wagers for {N days}. It'll lock now and quietly
     come back when the time's up — you can't turn it back on early."*
   - completely: *"You're stepping away from Wagers for good. It won't turn itself back
     on."*
   - Buttons: **Confirm** / **Cancel**.
3. Confirm → `optOut(key)` → sheet closes → feature locks instantly (tab gone, coins
   screen falls back to Home).

Because the control lives inside the Wagers surface and the surface is gone once
locked, there is no path to change the choice afterward — which is the intended
hard-lockout behavior.

### 4. The "?" About-Wagers sheet — new "Stepping away" section

Add a section to `WagersInfoSheet` (`screens-coins.jsx`) with supportive copy **and a
shield button that opens the opt-out flow directly** — so opt-out is reachable both
from the header and from the explainer. Example:

> 🛡 **Stepping away is OK.** Everyone's different. If you'd rather not take part — or if
> this feature could be harmful or a trigger for you — you absolutely should step away,
> and we 100% support that. It's completely anonymous: no one can see that you did it.
> You're free, welcome, and encouraged to do it any time it feels right for you.
>
> [ 🛡 Step away from Wagers ]

(Final wording polished during implementation; keep it warm and non-clinical.)

**Wiring:** the shield button in this section opens the same opt-out sheet as the
header `OptOutButton`. `CoinsScreen` owns both pieces of UI state — tapping the
in-sheet shield does `setInfo(false); setOptOut(true)`, handing off from the About
sheet to the opt-out sheet. `WagersInfoSheet` takes an `onOptOut` callback prop to
trigger this; it does not own the opt-out sheet itself.

## Testing (TDD — Vitest, `web/`)

Follows the existing web suite (`spoiler.test.js` is the template).

- **`optout.test.js`**
  - default: `isOptedOut()` false.
  - `optOut('7d')` → opted out; stored expiry ≈ now + 7 days.
  - expired timestamp in storage → `isOptedOut()` false (silent lift).
  - `optOut('forever')` → always opted out.
  - persists to localStorage; tolerates localStorage throwing (private mode) via mem.
- **`coins.test.js`** — `canWager()` false when opted out (adult + me present);
  true again once not opted out.
- **Component tests** (`components.test.jsx` / `App.test.jsx` / coins screen):
  - opted out ⇒ Wagers tab absent from nav; coins tab renders Home fallback.
  - Wagers header renders `OptOutButton` (shield) and **not** the spoiler eye.
  - opt-out sheet shows the five durations; Confirm calls `optOut` and locks.

## Out of scope / YAGNI

- No server persistence, no admin visibility, no cross-device sync (anonymity by
  design — it's purely the device in the person's hand).
- No countdown / "time remaining" UI anywhere.
- No early opt-back-in and no in-app reversal of "Completely".
- No change to minor gating, the spoiler/privacy eye on other screens, or the API.

## Files touched

- **new** `web/src/optout.js`, `web/src/optout.test.js`
- `web/src/coins.js` (gate), `web/src/coins.test.js`
- `web/src/components.jsx` (`AppHeader` `replaceSpoiler` prop; `useOptOut()` in
  `Nav`/`Sidebar`; new `OptOutButton`; a shield `Icon`)
- `web/src/screens-coins.jsx` (`CoinsScreen` owns the opt-out sheet + `optOut` state;
  `CoinsScreen` + `WalletHeader` wire `OptOutButton`; `WagersInfoSheet` gains the
  "Stepping away" section + `onOptOut` callback shield button)
- `web/src/App.jsx` (`useOptOut()` for re-render on flip)
- relevant component/App tests
