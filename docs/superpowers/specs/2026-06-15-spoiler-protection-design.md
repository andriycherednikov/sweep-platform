# Spoiler Protection (Privacy Mode) — design

**Date:** 2026-06-15
**Status:** Approved (ready for implementation plan)
**Scope:** Frontend only (`web/`). No backend, API, or schema changes.

## Problem

Participants who haven't yet watched a match get spoiled the moment they open the
app — finished-match scores are shown everywhere (Latest scores, match cards, the
match sheet, person/team fixture rows). We want an opt-in **spoiler protection**
mode: when enabled, finished-match scores are hidden behind a tappable "eye-off"
cover, and the user taps a match to reveal its score.

## Decisions (locked)

- **What is hidden:** the **score numbers only**. Outcome cues (W/D/L pill, dimmed
  losing team, scorer names / card tallies, standings, leaderboards) are **not**
  hidden. Simplicity over completeness — covering the digits is the feature.
- **Which matches:** **finished and live matches** (`status === "final" ||
  status === "live"`). Both carry a score that spoils, so both are covered (a live
  match still shows its `LIVE` minute label — that isn't a spoiler — but the score
  digits are covered). Upcoming matches have no score.
- **Event popups:** while spoiler mode is on, the ambient **match-event popups**
  (goal / card / kick-off / full-time floating reactions) for a **still-hidden**
  match are **suppressed** — they would announce the score or result. Social
  "backing/switching" reactions are unaffected (they don't reveal a result). Once
  you reveal a match's score, its future event popups flow normally.
- **Reveal memory:** tapping the eye reveals that match's score **for the current
  session only**. Revealed state lives in memory and is **cleared on app
  reload/relaunch** — opening the app fresh never spoils you. This is the core
  promise of the feature.
- **Default state:** **OFF (disabled) by default.** The app behaves exactly as it
  does today until a user opts in via the toggle.

## Architecture

Follows the app's established **module-store + `localStorage` + `useXxx()` hook**
pattern (as used by `sweeps.js`, `social.js`, `useInstallPrompt.js`). No React
Context, no new dependency.

### New store — `web/src/spoiler.js`

Device-global preference + ephemeral per-match reveal state.

- **Persistence:** boolean under `localStorage` key `sweep.spoiler.v1`.
  - `isSpoiler()` → reads the key; **absent ⇒ `false`** (OFF by default). Wrapped
    in `try/catch` for private-mode (convention in this codebase).
  - `setSpoiler(on)` → writes `'1'`/`'0'`, then `notify()`.
- **Reveal set:** `const revealed = new Set()` — **in-memory module state**, not
  persisted, so it naturally resets on reload.
  - `reveal(id)` → `revealed.add(id)` + `notify()`.
  - **Turning the mode ON clears `revealed`** (so enabling protection re-hides
    everything fresh). Turning it OFF leaves the set as-is (everything renders
    regardless).
  - `isRevealed(id)` → `revealed.has(id)` (exported for the popup gate, below).
- **Predicate (single source of truth):**
  `spoilerHidden(f)` ⇒ `isSpoiler() && (f.status === "final" || f.status === "live") && f.score && !revealed.has(f.id)`.
- **Subscription:** `notify()` iterates a `listeners` Set; `useSpoiler()` hook
  registers a forced-re-render listener and returns `{ on, setSpoiler, reveal }`
  (mirrors `useSweeps()` / `useSocial()`).

### New icon — `Icon.eyeoff`

Add one entry to the `Icon` map in `components.jsx` (~line 18-45): an eye with a
diagonal slash, same one-line inline-SVG style as the existing `eye` / `eyefill`.

### New component — `<ScoreCover f onReveal>`

In `components.jsx`, modeled on `WatchBtn` (`components.jsx:47-59`). A small rounded
tap-target sized to roughly the score footprint, rendering `Icon.eyeoff` in
`var(--muted2)`.

- `aria-label="Reveal score"`, `type="button"`.
- `onClick` calls `e.stopPropagation()` (so tapping the cover does **not** also open
  the match sheet / navigate) then `reveal(f.id)`.
- New `.spoiler-cover` CSS class in `styles.css`, sibling to `.watchbtn`, matching
  the chip/pill aesthetic (`#eef1f5` bg, muted icon, Matchday rounding).

### New component — `<SpoilerToggle>`

A single toggle component, reused in desktop and mobile chrome. Reads `useSpoiler()`.

- Renders eye/eye-off with `aria-pressed={on}`; toggles `setSpoiler(!on)`.
- **Desktop:** a labeled pill in the Sidebar footer `sb-foot` (`components.jsx:394`),
  e.g. "Hide scores".
- **Mobile:** a round 30×30 icon-button (matching the existing header buttons) added
  to the `HomeHeader` button row (`components.jsx:280-293`) **and** passed into
  `PageHeader`'s `right` slot (`components.jsx:310`) so it is reachable on the
  Schedule screen, where finished matches also appear.

### Event-popup muting — `FloatingReactions.jsx`

The ambient floating reactions are fed by `onNotification` (`notifications.js`),
which `useEventStream` pushes to for SSE `goal` / `card` / `score`(start/final) /
`support` events. Match events are stamped `kind: "match"` and carry `fixtureId`
(see `useEventStream.js:41-52`); social backing reactions have no `kind: "match"`.

In `FloatingReactions`'s `onNotification` handler (`FloatingReactions.jsx:18`), after
resolving the fixture, add an early return:

```js
if (n.kind === "match" && isSpoiler() && !isRevealed(n.fixtureId)) return;
```

- Gated only for `kind: "match"` popups (goal/card/kick-off/full-time) — these
  announce the score/result. Social "backing/switching" reactions still show.
- Evaluated **when the event arrives** (the handler reads `isSpoiler()` /
  `isRevealed()` live), so no extra re-render wiring is needed. Suppressed popups
  are not queued or replayed — revealing a match lets *future* events through, which
  is the intended behaviour for an ephemeral, real-time layer.

## Wired score sites (finals + live swap)

At each site, replace the score span with:
`spoilerHidden(f) ? <ScoreCover f={f}/> : <existing score markup>`.
Each site keeps its own existing styling/separator.

| Site | File:line | Score markup today |
|---|---|---|
| `MatchCard` mid | `components.jsx:248` | `<span className="mc-sc">{s1}<i>–</i>{s2}</span>` |
| Home "Latest scores" row | `screens-main.jsx:117` | `<span className="rscore">{f.score[0]} – {f.score[1]}</span>` |
| `MatchSheet` detail | `screens-detail.jsx:590` | `<span className="cd" …>{f.score[0]}–{f.score[1]}</span>` |
| `PersonDetail` fixture row | `screens-detail.jsx:143` | `<span className="sc">…–…</span>` |
| `TeamDetail` fixture row | `screens-detail.jsx:309` | `<span className="sc">…–…</span>` |
| `gpk-meta` summary | `screens-detail.jsx:440` | `${f.score[0]}–${f.score[1]}` text |
| Home hero **live** scoreline | `screens-main.jsx:170` | `<span className="cd">{next.score[0]}–{next.score[1]}</span>` |

The hero's `LIVE`/minute label stays; only the `cd` score digits are covered. The
hero cover only triggers when the next/featured match is live and unrevealed.

## Data flow

1. `useSpoiler()` subscribers re-render when the mode or reveal set changes.
2. On render, each score site asks `spoilerHidden(f)`.
3. Hidden ⇒ `<ScoreCover>`; tap → `reveal(f.id)` → `notify()` → that match
   re-renders with the real score. Other matches stay hidden.
4. A match event arriving over SSE is dropped by the popup gate while its match is
   hidden; once revealed, later events for that match render.
5. Reload ⇒ module re-init ⇒ `revealed` empty again ⇒ all finals/live re-hidden (if
   mode still on).

## Error / edge handling

- **Private mode / `localStorage` unavailable:** `try/catch` → treated as default
  (OFF); toggling still works in-session via the in-memory mirror.
- **Tapping the cover must not navigate:** `stopPropagation` on the cover click
  (cards/rows are themselves clickable to open detail).
- **Toggling OFF then ON:** ON clears the reveal set → fresh hide.
- **Match transitions live → final** during a session: once `final`, it becomes
  coverable on next render (not yet revealed) — acceptable and consistent.

## Testing (Vitest + React Testing Library)

- **`web/src/spoiler.test.js`** (store unit):
  - default `isSpoiler()` is `false` when key absent;
  - `setSpoiler(true)` persists and notifies; `false` reverts;
  - `reveal(id)` adds to set; `spoilerHidden` / `isRevealed` flip accordingly;
  - enabling the mode clears the reveal set;
  - `spoilerHidden` is `true` for live fixtures (with score) when mode on;
  - `spoilerHidden` is `false` for upcoming / scoreless fixtures.
- **`web/src/components.test.jsx`** (cases near the existing "Latest scores" tests):
  - mode ON + a `final` fixture ⇒ score text absent, cover (`aria-label`) present;
  - mode ON + a `live` fixture ⇒ score covered too;
  - click the cover ⇒ real score text appears;
  - mode OFF ⇒ score visible, no cover.
- **`web/src/FloatingReactions.test.jsx`** (popup gate):
  - mode ON + unrevealed match ⇒ a `kind:"match"` goal/final popup is suppressed;
  - after `reveal(fixtureId)` ⇒ a subsequent match popup renders;
  - a social "backing" reaction renders regardless of spoiler mode.
- Use the existing seed pattern: `setSweepData(assembleSweep({...}))` +
  `setSocialData(...)`; reset spoiler state in `beforeEach`.

## Out of scope (YAGNI)

- Hiding outcome cues (W/D/L pill, dimmed loser, scorer names), standings, or
  leaderboards.
- Per-sweep (vs per-device) preference, or syncing the preference across devices.
- Covering upcoming matches (they have no score).
- Persisting revealed matches across reloads, or replaying suppressed popups.
