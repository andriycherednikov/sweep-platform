# The Sweep — World Cup 2026

A mobile-first (and fully responsive desktop) web app for a local community's FIFA
World Cup 2026 sweep. Built from the **Matchday** design direction exported from
Claude Design. See the fixtures, who owns which team, live-ish results, standings,
per-person and per-team views, and a lightweight social layer — all read-only for
viewers with a hidden admin moderation queue.

## Stack

- **Vite + React 18** — single codebase, responsive from one tree.
- No backend in v1: deterministic placeholder data (`src/data.js`) stands in for the
  twice-daily API-Football pull described in the design brief. The social layer
  (identity, who's watching, team backing) persists per-device in `localStorage`.

## Run

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
npm run preview  # preview the production build
```

## Layout

- `src/data.js` — deterministic dataset: 48 teams, 16 people, fixtures, computed
  standings, derbies, photos, Sydney-time formatting.
- `src/social.js` — per-device identity / watching / support store.
- `src/components.jsx` — shared components (icons, match card, sidebar, headers…).
- `src/screens-main.jsx` — Home, Schedule, Standings, Knockouts.
- `src/screens-detail.jsx` — People, Person/Team detail, upload flow, match sheet, admin.
- `src/App.jsx` — shell, routing, modals (mobile bottom-tabs / desktop sidebar).
- `src/styles.css`, `src/desktop.css` — Matchday tokens + responsive desktop layer.

## Features

Home (personalized "Your next games", you're-watching, today, results, standings
snapshot, fan-photo banner) · Schedule with person/team filters · People directory +
person detail · Teams directory + team detail with fan photos · auto-calculated group
standings (all 12 at once on desktop) · empty Knockouts state · match detail sheet
(stake, back-a-team, who's-watching, share) · fan-photo upload flow · admin passcode
(`2026`) → photo moderation queue.

## Notes

- Flags are loaded from `flagcdn.com`.
- Demo "today" is anchored to **Sat 13 Jun 2026** (Sydney/AEST) so live/upcoming/final
  states read realistically; times display in AEST.
- The original design bundle is preserved under `design_unpack/` (git-ignored).
