# People Placement — finishing-order tab

**Date:** 2026-06-30
**Status:** Design approved, ready for plan
**Scope:** Frontend only. No backend, no schema, no migration, no re-sync.

## Goal

Show each sweep participant's **finishing position** — the order people are knocked
out, climbing to #1 (the winner). A new **"Placement"** tab on the People page. Each
person shows a placement number, a placement range, or nothing (still in).

## Core model

A person is eliminated the moment their **last surviving team** is eliminated. A
person's finishing order is decided by **when** that happens: the longer you last, the
better you place. This is ranked across people, not bucketed into fixed round bands.

> **Position = 1 + (number of people who outlasted you).**
> People knocked out at the **same time** share a **range**.

"Same time" = the same elimination event: co-owners of one eliminated team, or teams
knocked out in simultaneous games. Two games in the same round at different times do
**not** tie — the later game's losers place better.

### Worked example (the decisive case)

Two semi-finals, semi-A earlier than semi-B. Champion and runner-up single-owned;
each semi-losing team owned by 2 people.

| Person | Last team out | People above | Placement |
|---|---|---|---|
| Champion | — (won the cup) | 0 | 🏆 1 |
| Runner-up | lost the final | 1 | 2 |
| Semi-B losers (later game) | semi-B | 2 | 3–4 |
| Semi-A losers (earlier game) | semi-A | 4 | 5–6 |

The later semi loser beats the earlier semi loser, even though both lost in the semis.

### Properties this gives for free

- **Multiple winners.** A team can be co-owned, so a co-owned champion yields several
  people sharing the top — all badged 🏆, e.g. "🏆 1–2".
- **One elimination → multiple people → one range.** Co-owners of an eliminated team
  all settle at the same instant and share a range.

## Derivation (all from data already in `assemble.js`)

Everything comes from existing fixtures + `winnerCodeOf` + the elimination set already
computed in `assemble.js`. No bracket tree, no round labels, no displayed dates.

### Per team — `elimTime` (a sortable instant; never shown)

- **Lost a knockout match:** `ko` of the KO fixture it played and lost
  (`f.stage === 'knockout'`, `f.status === 'final'`, `winnerCodeOf(f)` is the other team).
  A losing team plays exactly one losing KO match.
- **Out in the group stage** (in the elimination set, never lost a KO match): the latest
  `ko` among its group fixtures (its last group game). These games are simultaneous, so
  group exits are intentionally coarse — group-eliminated people land in one wide range.
- **Champion** (`koWins === 5`, i.e. won every KO round R32→Final) and **still alive**:
  not eliminated → `elimTime = +∞`.

`koWins(team)` = count of KO fixtures where `winnerCodeOf(f) === team`. The constant `5`
is the number of WC-2026 KO rounds (R32, R16, QF, SF, Final); the codebase is already
WC-2026-specific (hard-coded `R32_DEFS`, `KNOWN_KO_TEAMS`).

### Per person — `effectiveElimTime`

1. Owns the champion team → champion (settled, rank 1), `effectiveElimTime = +∞`.
2. Else any team still alive (not eliminated, not champion) → **still in**,
   `effectiveElimTime = +∞`, **no placement rendered**.
3. Else (all teams eliminated) → `effectiveElimTime = max(team elimTime)` — the last
   team to fall (their deepest run).

Champion ⟺ the final has been played ⟺ no still-in people remain. So the `+∞` group is
either *all still-in* (no champion yet → render nothing) or *all champions* (render
"1"/range, badge 🏆) — never mixed.

### Placement (standard competition ranking, range display)

For person `P`:

- `start = 1 + count(people with effectiveElimTime strictly greater than P's)`
  — still-in and champion (`+∞`) count as "above", reserving the top slots.
- `size = count(people with effectiveElimTime equal to P's)` (the tie group).
- `end = start + size − 1`.
- Render `"start"` if `size === 1`, else `"start–end"`.

Positions are contiguous and cover `1..(number of people)`. Render rules:

- Still in (no champion among their teams, final not yet played) → **render nothing**.
- Champion → render placement (starts at 1) with a 🏆 badge.
- Eliminated → render placement number/range.

## UI

`PeopleScreen` (`web/src/screens-detail.jsx:36`) already has a `statseg` segmented
control (Wins / Predictions / Yowie Dollars) that swaps a per-person `statOf(m)` metric
and re-sorts. Add a fourth view, `"placement"`:

- **Button:** a 4th `statseg-opt` "Placement". Update the grid `gridTemplateColumns`
  count to include it. (Unlike Yowie Dollars, it is always shown — no 18+ gate.)
- **Metric:** `statOf` for `placement` returns the placement label (e.g. `"3–4"`, `"5"`,
  with a 🏆 prefix for champions) and `show: settled` (false → no stat block, the
  existing pattern for "still in").
- **Sort:** by `effectiveElimTime` descending (still-in + champion at top), tie-break by
  the existing `wins`. This is position ascending — #1 lands at the top once decided, the
  earliest-out at the bottom. (Flipping the direction is a one-line change if wanted.)
- **Sub-label:** e.g. `"<eliminated> of <total> placed · by finishing position"`.
- **"Hide eliminated" toggle, "OUT" badge:** the placement number already conveys "out",
  so suppress the red "OUT" badge in this view (it shows only in the Wins view today).
  The toggle keeps working (hiding eliminated leaves only the still-in rows).

## Where the calc lives

A new computation in `assemble.js`, beside the existing `money` / elimination logic,
exposed as `S.placementOf(personId)` returning `{ start, end, champion } | null`
(`null` = still in / not settled). The People list consumes it for both the metric and
the sort.

## Testing (TDD, per project rules)

Unit-test the placement calc in `assemble.test.js` against synthetic fixtures:

- The worked semi-final example → 🏆 1, 2, 3–4, 5–6 (later game beats earlier).
- Co-owned eliminated team → its owners share a range.
- Co-owned champion → owners share "1–N", all flagged champion.
- A person with one deep + one shallow team → placed by the deep (last-out) team.
- Still-in person → `null`.
- Group-stage exits → coarse shared range at the bottom.
- Position is contiguous `1..N` across a full synthetic tournament.

Component-level: `PeopleScreen` renders the Placement tab, shows ranges/numbers for
settled people and nothing for still-in, and orders #1 at the top.

## Out of scope (YAGNI)

- Teams page (user explicitly only cares about people).
- A dedicated 3rd-place playoff split (our bracket has no such match → semis stay joint).
- Showing the elimination day/date anywhere (used internally for ordering only).
- Any backend, schema, or worker change.
