# Phase 7a — PWA offline shell + installable home-screen app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Vite + React SPA into an installable, offline-capable PWA — one bundle serving both the website and a home-screen app — with iOS standalone polish, using `vite-plugin-pwa` in `injectManifest` mode.

**Architecture:** A single hand-written service worker (`web/src/sw.js`) precaches the content-hashed app shell and applies runtime caching (NetworkFirst for `/api`, CacheFirst for `/photos` + fonts, precached-shell fallback for navigations). The caching contract lives in a plain, testable descriptor module (`web/src/sw-routes.js`). The SW installs in the background and activates on the next cold launch (no `skipWaiting`, no prompt, no forced reload). iOS standalone meta tags make the installed app launch fullscreen. The SW is deliberately the future home of the already-planned match-reminders push handlers.

**Tech Stack:** Vite 5 + React 18 (web); `vite-plugin-pwa@^1.3.0` (Workbox 7.4.1); `workbox-precaching` / `workbox-routing` / `workbox-strategies` / `workbox-expiration`; Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-13-phase-7a-pwa-offline-install-design.md`

---

## File Structure

**Frontend (`web/`):**
- `package.json` — add `vite-plugin-pwa` + workbox runtime modules as devDependencies (modify).
- `pwa.config.js` — exports the `VitePWA` options object; plain, importable in tests (create).
- `vite.config.js` — register the `VitePWA` plugin from `pwa.config.js` (modify).
- `src/sw-routes.js` — plain runtime-caching descriptors; the testable caching contract (create).
- `src/sw.js` — the service worker source consumed by `injectManifest` (create).
- `src/lib/registerSW.js` — thin, testable wrapper around `virtual:pwa-register` (create).
- `src/main.jsx` — call `registerServiceWorker()` on load (modify).
- `index.html` — add iOS standalone + theme-color meta tags (modify).
- `vitest.config.js` — alias `virtual:pwa-register` to a test stub (modify).
- `test/stubs/pwa-register.js` — spy stub for the virtual module (create).

**Tests (`web/`):**
- `test/pwa-config.test.js` — asserts the plugin options contract (create).
- `src/sw-routes.test.js` — asserts the caching descriptors (create).
- `src/lib/registerSW.test.js` — asserts registration / no-op behaviour (create).
- `test/index-html.test.js` — asserts the iOS meta tags are present (create).

**Docs:**
- `CLAUDE.md` — mark Phase 7a, note the single-SW/push relationship (modify).

> **Note on test isolation:** Vitest uses `web/vitest.config.js`, which does **not** merge `web/vite.config.js`. Adding `VitePWA` to `vite.config.js` therefore does not affect the test runner. `pwa.config.js` and `src/sw-routes.js` are plain modules with **no** `vite-plugin-pwa`/workbox imports, so they import cleanly under jsdom. `src/sw.js` is never imported by tests (it only runs in a service-worker context) and is verified via the production build.

---

## Task 1: Add dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install vite-plugin-pwa + workbox runtime modules**

Run from the repo root:
```bash
npm install -D -w web \
  vite-plugin-pwa@^1.3.0 \
  workbox-precaching@^7.4.1 \
  workbox-routing@^7.4.1 \
  workbox-strategies@^7.4.1 \
  workbox-expiration@^7.4.1
```
Expected: the five packages appear under `devDependencies` in `web/package.json`; `npm install` completes without peer-dependency errors (vite-plugin-pwa 1.3.0 lists `vite ^5` as a supported peer).

- [ ] **Step 2: Verify the existing suite still passes (clean baseline after install)**

Run: `npm test -w web`
Expected: PASS — 148 tests (no behaviour changed yet; this just confirms the dependency install didn't break resolution).

- [ ] **Step 3: Commit**

```bash
git add web/package.json package-lock.json
git commit -m "chore(web): add vite-plugin-pwa + workbox runtime deps"
```

---

## Task 2: PWA plugin options module

**Files:**
- Create: `web/pwa.config.js`
- Create: `web/test/pwa-config.test.js`

> The plugin is wired into `vite.config.js` in **Task 4**, *after* `src/sw.js` exists — `injectManifest` fails the build if the SW source is missing, and the pre-commit hook builds on every commit. This task only adds the (plain, build-inert) options module and its test.

- [ ] **Step 1: Write the failing test**

Create `web/test/pwa-config.test.js`:
```js
import { describe, expect, test } from 'vitest'
import { pwaOptions } from '../pwa.config.js'

describe('vite-plugin-pwa options', () => {
  test('uses injectManifest so we own the service worker source', () => {
    expect(pwaOptions.strategies).toBe('injectManifest')
    expect(pwaOptions.srcDir).toBe('src')
    expect(pwaOptions.filename).toBe('sw.js')
  })

  test('keeps the existing site.webmanifest (does not regenerate one)', () => {
    expect(pwaOptions.manifest).toBe(false)
  })

  test('uses the next-launch update lifecycle (prompt, never auto-reload)', () => {
    // 'prompt' + a wrapper that never prompts/reloads => SW waits, activates next launch.
    expect(pwaOptions.registerType).toBe('prompt')
  })

  test('precaches the app shell asset types', () => {
    const globs = pwaOptions.injectManifest.globPatterns.join(',')
    for (const ext of ['js', 'css', 'html', 'svg', 'png', 'ico', 'woff2']) {
      expect(globs).toContain(ext)
    }
  })

  test('enables the SW in dev so it can be exercised locally', () => {
    expect(pwaOptions.devOptions.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- pwa-config`
Expected: FAIL — cannot resolve `../pwa.config.js`.

- [ ] **Step 3: Create the options module**

Create `web/pwa.config.js`:
```js
// vite-plugin-pwa options, factored out so they can be unit-tested without
// loading the plugin (vite.config.js imports and applies these).
export const pwaOptions = {
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.js',
  // Keep the hand-authored web/public/site.webmanifest; do not regenerate one.
  manifest: false,
  // 'prompt' + a register wrapper that never prompts/reloads => the new SW waits
  // and activates on the next cold launch (the chosen silent-next-launch lifecycle).
  registerType: 'prompt',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
  },
  devOptions: {
    enabled: true,
    type: 'module',
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- pwa-config`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/pwa.config.js web/test/pwa-config.test.js
git commit -m "feat(web): add vite-plugin-pwa injectManifest options module"
```

> No change to `vite.config.js` yet — the plugin is still inactive, so the pre-commit build runs exactly as before. Wiring happens in Task 4.

---

## Task 3: Runtime-caching descriptors (the testable caching contract)

**Files:**
- Create: `web/src/sw-routes.js`
- Create: `web/src/sw-routes.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/src/sw-routes.test.js`:
```js
import { describe, expect, test } from 'vitest'
import { SW_ROUTES } from './sw-routes.js'

const byId = (id) => SW_ROUTES.find((r) => r.id === id)

describe('service-worker runtime caching contract', () => {
  test('/api is NetworkFirst so online data is never stale', () => {
    const r = byId('api')
    expect(r.strategy).toBe('NetworkFirst')
    expect(r.pathPrefix).toBe('/api')
  })

  test('/photos is CacheFirst (approved photos are immutable) with expiration', () => {
    const r = byId('photos')
    expect(r.strategy).toBe('CacheFirst')
    expect(r.pathPrefix).toBe('/photos')
    expect(r.maxEntries).toBeGreaterThan(0)
    expect(r.maxAgeSeconds).toBeGreaterThan(0)
  })

  test('google fonts are CacheFirst, matched by origin, with expiration', () => {
    const r = byId('fonts')
    expect(r.strategy).toBe('CacheFirst')
    expect(r.origins).toContain('https://fonts.googleapis.com')
    expect(r.origins).toContain('https://fonts.gstatic.com')
    expect(r.maxAgeSeconds).toBeGreaterThan(0)
  })

  test('every route names a distinct cache', () => {
    const names = SW_ROUTES.map((r) => r.cacheName)
    expect(new Set(names).size).toBe(names.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- sw-routes`
Expected: FAIL — cannot resolve `./sw-routes.js`.

- [ ] **Step 3: Create the descriptor module**

Create `web/src/sw-routes.js`:
```js
// Plain, serialisable runtime-caching descriptors. No workbox imports here so
// the caching contract can be unit-tested under jsdom. web/src/sw.js translates
// each descriptor into a workbox route + strategy.
//
// Fields:
//   id           - stable identifier (used by tests/logging)
//   strategy     - 'NetworkFirst' | 'CacheFirst'
//   cacheName    - the named runtime cache
//   pathPrefix   - match requests whose URL pathname starts with this (optional)
//   origins      - match requests to one of these origins (optional)
//   maxEntries   - ExpirationPlugin cap (optional)
//   maxAgeSeconds- ExpirationPlugin TTL (optional)
export const SW_ROUTES = [
  {
    id: 'api',
    strategy: 'NetworkFirst',
    cacheName: 'sweep-api',
    pathPrefix: '/api',
    maxEntries: 64,
    maxAgeSeconds: 60 * 60, // 1h cap on the offline fallback snapshot
  },
  {
    id: 'photos',
    strategy: 'CacheFirst',
    cacheName: 'sweep-photos',
    pathPrefix: '/photos',
    maxEntries: 120,
    maxAgeSeconds: 30 * 24 * 60 * 60, // 30d
  },
  {
    id: 'fonts',
    strategy: 'CacheFirst',
    cacheName: 'sweep-fonts',
    origins: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    maxEntries: 30,
    maxAgeSeconds: 365 * 24 * 60 * 60, // 1y
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- sw-routes`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/sw-routes.js web/src/sw-routes.test.js
git commit -m "feat(web): define service-worker runtime caching descriptors"
```

---

## Task 4: Service worker source + activate the plugin

**Files:**
- Create: `web/src/sw.js`
- Modify: `web/vite.config.js`

> Not unit-tested: workbox runtime modules and `self.__WB_MANIFEST` only resolve inside the `injectManifest` build / a service-worker context, not jsdom. Verified by the production build emitting a valid `sw.js` (Step 3). The routing inputs are already guarded by `sw-routes.test.js` (Task 3).

- [ ] **Step 1: Create the service worker source**

Create `web/src/sw.js`:
```js
/* The Sweep service worker (injectManifest source).
   Responsibilities: precache the content-hashed app shell, apply runtime caching
   per SW_ROUTES, and serve the precached shell for SPA navigations.

   Lifecycle: we deliberately do NOT call self.skipWaiting() or clientsClaim().
   A new SW installs in the background, waits, and activates on the next cold
   launch — the chosen silent-next-launch update behaviour.

   FUTURE (match-reminders web-push spec): the 'push' and 'notificationclick'
   handlers are appended below the marker — this is the single SW for scope '/'. */
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { SW_ROUTES } from './sw-routes.js'

// Precache the app shell (filenames are content-hashed by Vite).
precacheAndRoute(self.__WB_MANIFEST)

const STRATEGIES = { NetworkFirst, CacheFirst }

for (const route of SW_ROUTES) {
  const Strategy = STRATEGIES[route.strategy]
  const plugins = []
  if (route.maxEntries || route.maxAgeSeconds) {
    plugins.push(
      new ExpirationPlugin({
        maxEntries: route.maxEntries,
        maxAgeSeconds: route.maxAgeSeconds,
        purgeOnQuotaError: true,
      }),
    )
  }
  const match = ({ url }) => {
    if (route.pathPrefix && url.pathname.startsWith(route.pathPrefix)) return true
    if (route.origins && route.origins.includes(url.origin)) return true
    return false
  }
  registerRoute(match, new Strategy({ cacheName: route.cacheName, plugins }))
}

// SPA navigations → the precached app shell (instant + offline-capable).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// ── match-reminders push handlers go here (see web-push spec) ──────────────
```

- [ ] **Step 2: Activate the plugin in the build config**

Now that `src/sw.js` exists, wire `VitePWA` into `web/vite.config.js`:
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config.js'

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions)],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/photos': 'http://localhost:3000', // approved photos are served by the api (Caddy in prod)
    },
  },
})
```

- [ ] **Step 3: Run the unit suite (unchanged, still green)**

Run: `npm test -w web`
Expected: PASS — 157 tests so far (148 baseline + 5 pwa-config + 4 sw-routes). Vitest uses `vitest.config.js`, so the new `vite.config.js` plugin does not affect it; `sw.js` is not imported by any test.

- [ ] **Step 4: Run the production build and verify the SW is emitted**

Run: `npm run build -w web`
Expected: build succeeds; then verify the artifacts:
```bash
ls web/dist/sw.js && grep -c "precacheAndRoute\|__WB_MANIFEST\|self.__WB_MANIFEST" web/dist/sw.js
```
Expected: `web/dist/sw.js` exists, and the precache manifest token has been injected (the build replaces `self.__WB_MANIFEST` with the real asset list — confirm `web/dist/sw.js` references the hashed assets, e.g. `grep -o "index-[A-Za-z0-9]*\.js" web/dist/sw.js`). Also confirm `web/dist/index.html` and `web/dist/site.webmanifest` are present.

- [ ] **Step 5: Commit**

```bash
git add web/src/sw.js web/vite.config.js
git commit -m "feat(web): add injectManifest service worker + activate PWA plugin"
```

---

## Task 5: Service-worker registration wrapper

**Files:**
- Modify: `web/vitest.config.js`
- Create: `web/test/stubs/pwa-register.js`
- Create: `web/src/lib/registerSW.js`
- Create: `web/src/lib/registerSW.test.js`
- Modify: `web/src/main.jsx`

- [ ] **Step 1: Alias the virtual module for tests**

Modify `web/vitest.config.js` to map the plugin's virtual module to a stub (the virtual module only exists in a real `vite-plugin-pwa` build):
```js
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./test/stubs/pwa-register.js', import.meta.url)),
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test/setup.js'] },
})
```

- [ ] **Step 2: Create the stub**

Create `web/test/stubs/pwa-register.js`:
```js
// Stand-in for vite-plugin-pwa's generated `virtual:pwa-register` module.
// Used only under vitest (see resolve.alias in vitest.config.js).
import { vi } from 'vitest'

// registerSW(options) => updateSW(reloadPage?) ; we return a spy for both.
export const registerSW = vi.fn(() => vi.fn())
```

- [ ] **Step 3: Write the failing test**

Create `web/src/lib/registerSW.test.js`:
```js
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { registerSW } from 'virtual:pwa-register' // aliased to the stub
import { registerServiceWorker } from './registerSW.js'

describe('registerServiceWorker', () => {
  beforeEach(() => registerSW.mockClear())
  afterEach(() => { delete globalThis.__nav })

  test('registers the service worker when supported', async () => {
    const nav = { serviceWorker: {} }
    await registerServiceWorker(nav)
    expect(registerSW).toHaveBeenCalledTimes(1)
    // immediate registration, no auto-reload handlers (next-launch lifecycle)
    const opts = registerSW.mock.calls[0][0] ?? {}
    expect(opts.onNeedRefresh).toBeUndefined()
    expect(opts.onRegisteredSW).toBeUndefined()
  })

  test('is a no-op when service workers are unsupported', async () => {
    const result = await registerServiceWorker({}) // no serviceWorker key
    expect(result).toBeNull()
    expect(registerSW).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w web -- registerSW`
Expected: FAIL — cannot resolve `./registerSW.js`.

- [ ] **Step 5: Create the wrapper**

Create `web/src/lib/registerSW.js`:
```js
// Thin wrapper around vite-plugin-pwa's virtual register module.
// No options => the new SW waits and activates on the next cold launch
// (no prompt, no auto-reload). Feature-detected so a non-PWA browser is unaffected.
export async function registerServiceWorker(nav = globalThis.navigator) {
  if (!nav || !('serviceWorker' in nav)) return null
  const { registerSW } = await import('virtual:pwa-register')
  return registerSW({ immediate: true })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -w web -- registerSW`
Expected: PASS — 2 tests.

- [ ] **Step 7: Call it from the app entry**

Modify `web/src/main.jsx` to register the SW after the root renders:
```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import { registerServiceWorker } from "./lib/registerSW.js";
import "./styles.css";
import "./desktop.css";

ReactDOM.createRoot(document.getElementById("appmount")).render(
  <SweepProvider><App /></SweepProvider>
);

registerServiceWorker();
```

- [ ] **Step 8: Run the full suite**

Run: `npm test -w web`
Expected: PASS — 159 tests (157 + 2 registerSW).

- [ ] **Step 9: Commit**

```bash
git add web/vitest.config.js web/test/stubs/pwa-register.js web/src/lib/registerSW.js web/src/lib/registerSW.test.js web/src/main.jsx
git commit -m "feat(web): register service worker on load (next-launch lifecycle)"
```

---

## Task 6: iOS standalone meta tags

**Files:**
- Create: `web/test/index-html.test.js`
- Modify: `web/index.html`

- [ ] **Step 1: Write the failing test**

Create `web/test/index-html.test.js`:
```js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')

describe('index.html iOS standalone metas', () => {
  test('declares apple-mobile-web-app-capable', () => {
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/?>/)
  })
  test('sets the status bar style for notch-safe standalone', () => {
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"\s*\/?>/)
  })
  test('sets the home-screen app title', () => {
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-title"\s+content="The Sweep"\s*\/?>/)
  })
  test('sets a theme-color matching the manifest', () => {
    expect(html).toMatch(/<meta\s+name="theme-color"\s+content="#0b1f3a"\s*\/?>/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- index-html`
Expected: FAIL — none of the four metas are present.

- [ ] **Step 3: Add the meta tags**

Modify `web/index.html` — add these four lines inside `<head>`, immediately after the existing `<link rel="manifest" href="/site.webmanifest">` line:
```html
<meta name="theme-color" content="#0b1f3a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="The Sweep">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- index-html`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/test/index-html.test.js web/index.html
git commit -m "feat(web): add iOS standalone + theme-color meta tags"
```

---

## Task 7: Full verification + docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full suite + production build (green gate)**

Run:
```bash
npm test -w web
npm run build -w web
```
Expected: tests PASS (163 total: 148 + 5 + 4 + 2 + 4); build succeeds and `web/dist/sw.js`, `web/dist/index.html`, `web/dist/site.webmanifest` are all present.

- [ ] **Step 2: Document Phase 7a in CLAUDE.md**

Modify `CLAUDE.md` — under the "Build order" list, append:
```markdown
7. **PWA home-screen app (7a)** — *shipped* (`docs/superpowers/plans/2026-06-13-phase-7a-pwa-offline-install.md`):
   installable, offline-capable PWA via `vite-plugin-pwa` (injectManifest). One service
   worker (`web/src/sw.js`); the planned match-reminders push handlers extend that same
   file (only one SW per scope), superseding that plan's `public/sw.js` step.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record phase 7a PWA + single-SW relationship to push plan"
```

- [ ] **Step 4: Manual on-device verification (record results; cannot be unit-tested)**

Perform and confirm each:
1. `npm run build -w web` → serve `web/dist` (e.g. `npx vite preview -w web`) → load in a browser; DevTools → Application → Service Workers shows the SW activated.
2. On an iPhone (Safari) over the deployed/preview URL: Share → Add to Home Screen → launch from the icon → confirm fullscreen (no Safari chrome) and a notch-safe status bar.
3. Airplane mode → cold-launch the installed app → confirm the app shell renders (not a browser error page); previously-loaded data shows from the cached `/api` snapshot if present, otherwise the app's existing loading/error UI appears.
4. Back online → confirm scores/standings refresh from the network and the SSE live stream connects.
5. Rebuild with a visible change and redeploy → confirm an open session keeps the old build, and the next cold launch shows the new build.

---

## Self-review notes

- **Spec coverage:** injectManifest tooling (T1–T2), single-SW design + reserved push marker (T4, T7 docs), precache shell (T4), NetworkFirst `/api` + CacheFirst photos/fonts (T3–T4), navigation fallback to precached shell (T4), next-launch lifecycle / no skipWaiting / no prompt (T2 registerType, T4 SW, T5 wrapper), iOS metas (T6), config + registerSW + iOS-metas tests (T2, T3, T5, T6), manual verification (T7) — all mapped.
- **Out of scope confirmed absent:** no Web Push/VAPID, no splash startup images, no Capacitor, no API-base refactor.
- **Type/name consistency:** `pwaOptions` (T2), `SW_ROUTES` with fields `id/strategy/cacheName/pathPrefix/origins/maxEntries/maxAgeSeconds` (T3 used identically in T4), `registerServiceWorker(nav?)` (T5 defined, called in main.jsx), `virtual:pwa-register` alias + stub `registerSW` spy (T5) — consistent across tasks.
