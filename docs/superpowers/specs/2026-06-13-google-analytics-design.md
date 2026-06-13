# The Sweep — Google Analytics (GA4) design

**Date:** 2026-06-13
**Status:** Approved for planning
**Scope:** Frontend only (`web/`). No backend/API changes.

## Goal

See how the ~45 participants actually use the app — which screens they visit and
which key actions they take — using Google Analytics 4 (GA4). Aggregate, anonymous
insight only; no per-person identification.

## Decisions (locked)

| Question | Decision |
|---|---|
| Depth | Pageviews (SPA route changes) **+** key custom events |
| Identity | **Anonymous only** — never send the viewer's id/name |
| Consent | **No cookie banner**; rely on GA4 IP anonymization |
| Environment | **Production builds only** — never loads in dev or tests |
| Measurement ID | Not created yet; human creates the GA4 property and supplies `G-XXXXXXXXXX` |
| Library | **No dependency** — a thin in-repo wrapper around Google's `gtag.js` |

## Why no dependency

The project is deliberately lean (only `@tanstack/react-query` was added). A wrapper
module is ~30 lines, fully testable, and avoids pulling in `react-ga4` to do what we
can own outright. Hardcoding the `<script>` in `index.html` was rejected because it
would load and report in dev/test too, polluting the data.

## Architecture

```
 App view state ──(useEffect on view)──▶ trackPageview(urlFor(view)) ─┐
 setSupport(mid,code) ─────────────────▶ trackEvent("vote_cast", …)   ├─▶ gtag() ─▶ GA4
 openMatch(f) ─────────────────────────▶ trackEvent("match_open", …)  │
 appinstalled event ───────────────────▶ trackEvent("pwa_install")  ──┘
```

All arrows funnel through one module. If GA is not enabled (dev, tests, or no
`VITE_GA_ID`), every call is a silent no-op and nothing reaches the network.

### Component 1 — `web/src/lib/analytics.js` (new)

The single seam between the app and Google.

- **`initAnalytics()`**
  - Guard: do nothing unless `import.meta.env.PROD && import.meta.env.VITE_GA_ID`.
  - Idempotent (a module-level `initialized` flag prevents double-injection).
  - When enabled: inject the `https://www.googletagmanager.com/gtag/js?id=<ID>`
    script, define `window.dataLayer` + `gtag()`, then
    `gtag('config', ID, { anonymize_ip: true, send_page_view: false })`.
  - `send_page_view: false` because this is an SPA — we emit pageviews ourselves on
    route change rather than letting gtag fire one only on hard load.
- **`trackPageview(path)`** — `gtag('event', 'page_view', { page_path, page_location, page_title })`.
- **`trackEvent(name, params = {})`** — `gtag('event', name, params)`.
- **Safety:** `trackPageview`/`trackEvent` no-op if not initialized or `window.gtag`
  is absent, and are wrapped so a throwing gtag never propagates into the app.

**What it does:** owns all Google contact. **How you use it:** call `initAnalytics()`
once, then `trackPageview`/`trackEvent`. **Depends on:** `import.meta.env` only.

### Component 2 — Pageview wiring (`web/src/App.jsx`, edits)

- Call `initAnalytics()` once inside the existing mount `useEffect`.
- Add a `useEffect` keyed on `view` that calls `trackPageview(urlFor(view))`.
  Both `navigate()` and the `popstate` handler already update `view`, so forward
  navigation and browser back/forward are both captured with no extra wiring.
- Reuses the existing `urlFor(view)` map, so screens become virtual pages:
  `/`, `/schedule`, `/people`, `/teams`, `/standings`, `/teams/:code`,
  `/people/:id`, `/knockouts`, `/admin`.

### Component 3 — Event wiring (3 events)

Modals/sheets are **not** in `urlFor` (kept in `history.state` only), so they are
genuine events rather than pageviews.

| Event | Params | Call site (chokepoint) |
|---|---|---|
| `vote_cast` | `{ pick: "home" \| "draw" \| "away", match_id }` | `setSupport(mid, code)` — `web/src/social.js:56` |
| `match_open` | `{ match_id }` | `openMatch(f)` — `web/src/App.jsx:81` |
| `pwa_install` | _(none)_ | `appinstalled` window listener — `web/src/hooks/useInstallPrompt.js:39` |

Notes:
- `vote_cast` `pick` is derived from `code`: the fixture's `t1` → `"home"`,
  `t2` → `"away"`, the `DRAW` sentinel → `"draw"`. `match_id` = `mid`. Wiring at
  `setSupport` (one place) covers every vote UI, current and future.
- `match_open` fires in `openMatch`, the single place the match modal is created.
- `pwa_install` hooks the existing `appinstalled` listener (the truest signal — it
  fires on a real install via any path). iOS Safari has no install API, so manual
  iOS "Add to Home Screen" is not counted.

### Component 4 — Config / env

- New var **`VITE_GA_ID`** (Vite auto-exposes `VITE_`-prefixed vars to the client).
  Empty/unset ⇒ analytics fully disabled.
- Add to `.env.example` (commented, no value) and to the env table in `CLAUDE.md`.
- **Prod build must pass `VITE_GA_ID` at build time.** Vite inlines `import.meta.env`
  at build, so the value must be present when `npm run build` runs in the
  Docker/Caddy deploy. The plan will document the exact build-arg wiring.

## Data flow

1. App loads in prod → `initAnalytics()` injects gtag and configures GA4.
2. User changes screen → `view` updates → `trackPageview` sends a `page_view`.
3. User votes / opens a match / installs → the chokepoint calls `trackEvent`.
4. gtag batches and sends to GA4; the GA dashboard shows screens + events.

In dev and tests, step 1's guard fails, so steps 2–3 are no-ops.

## Privacy posture

- No banner (private, invite-only ~45-person group).
- `anonymize_ip: true`.
- No viewer identity, name, or device id is ever sent — only the event name, the
  virtual path, and the small param set above (`pick`, `match_id`).

## Error handling

Analytics must never break the app. Missing gtag, a failed script load, or a
throwing gtag call are all swallowed. The app behaves identically whether or not
analytics is enabled.

## Testing (TDD, per task)

- **`web/src/lib/analytics.test.js`**
  - Not configured (the test default — `PROD` is false): `initAnalytics()` injects
    no script; `trackPageview`/`trackEvent` are no-ops and never throw.
  - With a stubbed enabled state + fake `window.gtag`: `trackPageview` forwards the
    path; `trackEvent` forwards name + params.
- **`App` test:** a simulated route change triggers exactly one `trackPageview` with
  the expected path (gtag/wrapper mocked).
- **Event call sites:** assert the event fires with correct params —
  `vote_cast` pick/`match_id` mapping, `match_open` `match_id`, `pwa_install` on
  accepted outcome.

## Human steps (outside the code)

1. Create a GA4 property in the Google Analytics console → add a Web data stream for
   the prod domain(s) → copy the **Measurement ID** (`G-XXXXXXXXXX`).
2. Provide it as `VITE_GA_ID` to the production build environment.
   (Exact build-arg location documented in the implementation plan.)

## Out of scope (YAGNI)

- Cookie-consent banner / opt-in UI.
- Per-person identity or user-id reporting.
- Photo-upload event (explicitly dropped).
- Backend/server-side analytics, custom dashboards, BigQuery export.
- Scroll depth, per-button granular tracking, notification-dismiss events.
