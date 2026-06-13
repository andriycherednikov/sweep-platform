# Phase 7a — PWA home-screen app (offline shell + installable) — design

**Date:** 2026-06-13
**Status:** Approved, ready to plan
**Feature:** Turn the existing Vite + React SPA into a proper installable, offline-capable
PWA — one codebase serving both the website and a home-screen app — with iOS standalone
polish. No App Store, no native wrapper.

## Goal

A participant can add The Sweep to their home screen (iOS and Android) and get a real
app experience: launches fullscreen and instantly from a precached shell, works as a frame
when offline, shows last-known data on an offline cold-start, and always shows fresh live
data when online. New deploys are picked up automatically on the next launch without a
prompt or a surprise mid-match reload.

The same built bundle serves the browser and the installed app — there is no second app to
maintain. All additions are feature-detected and inert in a plain browser tab.

## Decisions (from brainstorming)

- **No App Store, no Capacitor / native wrapper.** Enhance the PWA in place.
- **One codebase, both targets.** PWA behaviour is additive and feature-detected.
- **Tooling:** `vite-plugin-pwa` in **`injectManifest` mode** (Workbox under the hood) — we
  hand-write the service worker source and Workbox injects the precache manifest.
- **One service worker.** There is only one SW per scope (`/`). This SW must be the future
  home of the already-planned match-reminders push handlers (see Compatibility), so we own
  the source file rather than letting Workbox fully generate it (`generateSW`).
- **Caching:** precache the app shell; `/api/*` is **NetworkFirst** (fresh online, cached
  fallback offline); `/photos/*` and Google Fonts are **CacheFirst** (immutable/heavy);
  SPA navigations fall back to cached `index.html`.
- **Update lifecycle:** **silent auto-update on next launch.** A new build's SW installs in
  the background and waits; it activates on the next cold launch. No `skipWaiting`, no forced
  reload, no refresh prompt.
- **iOS standalone polish:** add the `apple-mobile-web-app-*` and `theme-color` meta tags.
- **Splash startup images:** deferred (documented follow-up). iOS shows a `#0b1f3a`
  background flash on launch, which is acceptable for v1.

## Non-goals (v1)

- **Web Push / notifications** — covered by the separate, already-written
  `docs/superpowers/specs/2026-06-12-match-reminders-web-push-design.md`. 7a only builds the
  service worker that push will later extend.
- **iOS `apple-touch-startup-image` splash screens** — documented follow-up, not built now.
- **Background sync / offline mutations** (queuing votes/uploads made while offline).
- **Capacitor or any native shell**, and any App Store distribution.
- **Caching live data as authoritative offline** — online users are never served stale data
  (NetworkFirst), and there is no attempt to make the app fully usable offline beyond showing
  the shell + last-known snapshot.

## Why this fits the codebase

- The frontend is a clean Vite 5 + React 18 SPA mounted at `#appmount`
  (`web/src/main.jsx`), with a single entry — a natural place to register the SW.
- `web/public/site.webmanifest` already declares `display: standalone`, theme/background
  colors (`#0b1f3a`), and 192/512 icons. Nothing in the manifest needs to change.
- `web/index.html` already sets `viewport-fit=cover` and an `apple-touch-icon`; it is only
  missing the `apple-mobile-web-app-*` and `theme-color` metas.
- There is **no existing service worker** on `main` — this is the app's first SW.
- API access is same-origin in prod (Caddy) and via the dev proxy (`/api`, `/photos`), so
  runtime-caching by URL prefix is straightforward and needs no API-base refactor.

## Architecture

```
build (vite + vite-plugin-pwa, injectManifest):
   web/src/sw.js  ──Workbox injects self.__WB_MANIFEST──►  dist/sw.js  (content-hashed precache)
   dist/ also contains the existing /site.webmanifest (unchanged)

runtime (browser tab OR installed home-screen app — same bundle):
   main.jsx → registerSW()  (only if 'serviceWorker' in navigator)
       └─ registers dist/sw.js at scope '/'

service worker (web/src/sw.js):
   install   → precacheAndRoute(self.__WB_MANIFEST)        // app shell, content-hashed
   fetch /api/*    → NetworkFirst   (fresh online; cached fallback offline)
   fetch /photos/* → CacheFirst     (approved photos are immutable)
   fetch fonts     → CacheFirst + expiration (Google Fonts)
   navigation      → NetworkFirst → cached index.html      // SPA fallback
   // FUTURE (match-reminders spec): 'push' + 'notificationclick' handlers append here
```

### Update lifecycle (precise behaviour)

1. A new deploy ships a new `sw.js` (its precache references new content-hashed asset names).
2. The browser detects the byte-different SW, installs it in the background, and it enters
   the **waiting** state. The currently-open session keeps running the old build off its
   still-valid content-hashed assets.
3. We deliberately **do not** call `skipWaiting()` and **do not** auto-reload. The waiting SW
   activates and claims clients on the **next cold launch** (all app windows closed, then
   reopened).
4. Because asset filenames are content-hashed, there is no stale-asset ambiguity: a launch is
   either fully on the old build or fully on the new one.

This is the "silent auto-update on next launch" decision. It avoids both the surprise
mid-match reload (force-update) and the refresh toast — neither was wanted.

## Components

### `web/src/sw.js` (new) — the service worker source

Hand-written Workbox source consumed by `injectManifest`. Responsibilities:

- `precacheAndRoute(self.__WB_MANIFEST)` — the build-injected shell manifest.
- Runtime routes (Workbox `registerRoute` + strategies):
  - `url.pathname.startsWith('/api')` → `NetworkFirst` (named cache, small `maxEntries`,
    short `maxAgeSeconds`).
  - `url.pathname.startsWith('/photos')` → `CacheFirst` (named cache, expiration).
  - Google Fonts stylesheet/static (`fonts.googleapis.com` / `fonts.gstatic.com`) →
    `CacheFirst` with expiration.
  - Navigation requests → `NetworkFirst` falling back to the precached `index.html`.
- **Does not** call `self.skipWaiting()` or `clientsClaim()` (next-launch lifecycle).
- Reserved space (commented) for the future `push` / `notificationclick` handlers.

### `web/src/lib/registerSW.js` (new) — thin, testable registration wrapper

- Wraps the `virtual:pwa-register` module (`registerSW`) from `vite-plugin-pwa`.
- No-op when `'serviceWorker' in navigator` is false (older browsers, SSR-less safety).
- Configured for the next-launch lifecycle: registers the SW but does **not** auto-reload
  and does **not** surface an `onNeedRefresh` prompt — the waiting SW activates on next launch.
- Exposes a single function called once from `main.jsx`.

### `web/src/main.jsx` (modify)

- Import and call `registerSW()` after the React root renders. One added line + import.

### `web/vite.config.js` (modify)

- Add the `VitePWA({...})` plugin with:
  - `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.js'`.
  - `registerType: 'prompt'` — and the wrapper deliberately does **not** prompt or reload.
    Combined with a SW source that never calls `skipWaiting`, a new SW simply waits and
    activates on the next cold launch. (We avoid `'autoUpdate'`, whose generated register
    code auto-reloads the open page when a new SW is found — the opposite of the chosen
    next-launch lifecycle.)
  - `manifest: false` — we keep the existing `web/public/site.webmanifest` and its `<link>`;
    the plugin does not regenerate it.
  - `injectManifest` globs covering the shell (`**/*.{js,css,html,svg,png,ico,woff2}`).
  - `devOptions.enabled: true` so the SW can be exercised in dev when needed.

### `web/index.html` (modify)

Add to `<head>`:
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `<meta name="apple-mobile-web-app-title" content="The Sweep">`
- `<meta name="theme-color" content="#0b1f3a">`

## Data flow (caching contract)

| Request | Strategy | Online | Offline / flaky |
|---|---|---|---|
| App shell (JS/CSS/HTML/icons) | Precache | Served from cache (instant) | Served from cache (instant) |
| `/api/*` | NetworkFirst | Network (always fresh) | Last cached response, else error state |
| `/photos/*` | CacheFirst | Cache, network on miss | Cache |
| Google Fonts | CacheFirst | Cache, network on miss | Cache |
| Navigation | NetworkFirst → `index.html` | Network, else shell | Cached `index.html` |

Live data freshness while online is unaffected: NetworkFirst always tries the network first,
and the existing SSE stream (`/api/stream`) continues to push live updates on top once the
app is open and connected.

## Error handling / edge cases

- **No `serviceWorker` support** → `registerSW()` is a no-op; the app behaves exactly as the
  current website. No regression.
- **Offline cold-start** → shell loads from precache; `/api` requests fall back to the last
  cached snapshot if present, otherwise the app shows its existing loading/error UI
  (`SweepProvider` already renders a retry path). No white screen.
- **SSE while offline** → `EventSource` simply fails to connect and retries (existing
  behaviour, `useEventStream`); unaffected by the SW.
- **Cache growth** → `/photos` and fonts caches use Workbox `ExpirationPlugin`
  (`maxEntries` / `maxAgeSeconds`) so storage cannot grow unbounded.
- **Stuck-on-old-build** → structurally prevented by content-hashed precache + next-launch
  activation; a launch is always fully one build or the other.

## Testing (TDD, Vitest + jsdom)

Service workers do not execute in jsdom, so coverage is layered:

- **Plugin config** (`web/vite.config.test.js` or equivalent): assert the resolved
  `vite-plugin-pwa` options — `injectManifest` strategy, `manifest: false`, the next-launch
  `registerType` configuration, and the presence/shape of the runtime-caching route rules
  (NetworkFirst `/api`, CacheFirst `/photos` + fonts). This guards the caching contract: a
  changed strategy breaks a test.
- **`registerSW` wrapper** (`web/src/lib/registerSW.test.js`): with `virtual:pwa-register`
  mocked, assert it registers on load, wires the no-prompt/no-reload lifecycle, and is a
  no-op when `serviceWorker` is absent from `navigator`.
- **iOS metas** (`web/index.html` parse test): assert the four `<meta>` tags exist — a cheap
  regression guard.
- **SW routing logic** — not unit-tested (no SW runtime in jsdom); covered by the production
  build emitting a valid `sw.js` and by manual device verification.

## Manual verification (cannot be unit-tested)

1. `npm run build -w web` → serve `dist/` → confirm `sw.js` is emitted and registers.
2. Install to the iOS home screen (Share → Add to Home Screen); confirm fullscreen launch
   (no Safari chrome) and correct status-bar treatment under the notch.
3. Airplane mode → cold launch → app shell renders (no browser error page).
4. Online → confirm live scores/standings are fresh (network), SSE updates flow.
5. Deploy a new build → confirm the open session is unchanged, and the next cold launch runs
   the new build.

## Dependencies

- **`vite-plugin-pwa`** (dev dependency, `web` workspace) — the canonical Vite PWA plugin;
  bundles Workbox. No hand-rolled service-worker tooling or cache versioning.

## Configuration / env

None. No new environment variables. (Web Push, which needs VAPID keys, is the separate
match-reminders spec.)

## Compatibility — relationship to the match-reminders Web Push spec

`docs/superpowers/specs/2026-06-12-match-reminders-web-push-design.md` (and its plan) were
written before this one and explicitly deferred offline caching to "a separate spec" — this
is that spec. That spec's service worker was scoped as "notifications-only" at
`web/public/sw.js`.

Because only one service worker can own scope `/`, when the match-reminders plan resumes its
SW work must target **this** SW source (`web/src/sw.js`) rather than create a second file.
Concretely, the match-reminders plan's "create `web/public/sw.js`" step is superseded:
its `push` and `notificationclick` handlers are **appended to `web/src/sw.js`** instead.
7a leaves a reserved, commented section in `web/src/sw.js` for exactly this. No other part of
the match-reminders design changes.

## Rollout notes

- First deploy after 7a installs the SW for all visitors on next load; already-installed
  home-screen instances (if any) gain offline behaviour on next launch — no reinstall needed.
- iOS users must add to the home screen to get the fullscreen standalone experience; the
  existing install nudge (`useInstallPrompt` / `InstallPrompt.jsx`) already covers iOS's
  manual "Add to Home Screen" path.
