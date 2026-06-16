# People screen — Wins ⇄ Predictions stat toggle

**Date:** 2026-06-16
**Status:** Approved, ready to implement

## Problem

The People screen lists every participant but the right-side stat pill only ever
shows **team wins**. There is no at-a-glance way to compare everyone's *prediction*
performance — that data only lives on each person's detail page and in the home
"Best predictions" widget (top 4). Showing both wins and predictions on every row
would crowd the layout.

## Solution

Add a compact two-option segmented toggle above the People list: **Wins** | **Predictions**.
The toggle swaps the right-side stat pill and the list sort. Default is **Wins** so the
screen opens exactly as it does today.

### Component

`PeopleScreen` in `web/src/screens-detail.jsx`.

### Behavior

- **Toggle:** segmented control, options `Wins` (default) and `Predictions`. State is local
  to the screen and persists while searching.
- **Stat pill per row:**
  - Wins view → `m.wins` with label `win`/`wins`; pill hidden when `wins === 0` (unchanged).
  - Predictions view → correct-prediction count `predictionAccuracy(p.id).correct` with label
    `correct`; pill hidden when count is `0`. This is the same bare number shown by the home
    "Best predictions" widget — no percentage, no total.
- **Sort follows the toggle:**
  - Wins → current `S.money` order (by team wins / money rank).
  - Predictions → list re-sorted by correct-prediction count, descending.
- **Subtitle:** `PageHeader` sub text reflects the active view — "sorted by team wins" vs
  "sorted by correct predictions".
- **Search:** name/team filtering works in both views; the active toggle is preserved.

### Data

Reuse `predictionAccuracy(personId)` from `web/src/social.js` (returns `{correct, total}`);
only `.correct` is used. Add `useSocial()` to `PeopleScreen` so the counts re-render live as
support/picks arrive over SSE.

### Styling

Add a small `.statseg` segmented control to `web/src/styles.css`, mirroring the existing
`.admintab` look (pill buttons; active = navy, inactive = card). Compact, placed in the same
max-width column as the search box.

## Testing (TDD)

Extend `web/src/screens-detail.test.jsx`:

- Default view shows team wins and the "sorted by team wins" subtitle.
- Toggling to Predictions shows each person's correct-call count, the "correct" label, and the
  "sorted by correct predictions" subtitle.
- Predictions view orders rows by correct count, descending.
- The toggle selection persists across a search query.

## Out of scope (YAGNI)

- No changes to the home "Best predictions" widget or person detail header.
- No percentages or correct/total ratios on the list.
- No persistence of the toggle across navigation/sessions.
