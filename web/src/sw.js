/* The Sweep service worker (injectManifest source).
   Responsibilities: precache the content-hashed app shell, apply runtime caching
   per SW_ROUTES, and serve the precached shell for SPA navigations.

   Lifecycle (autoUpdate): a freshly-deployed SW skips waiting and claims open
   clients as soon as it installs, then the page reloads onto the latest build
   (vite-plugin-pwa registerType 'autoUpdate' + src/lib/registerSW.js). This stops
   users getting stuck on a stale precached bundle until they close every tab.

   FUTURE (match-reminders web-push spec): the 'push' and 'notificationclick'
   handlers are appended below the marker — this is the single SW for scope '/'. */
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { SW_ROUTES } from './sw-routes.js'

// Activate a new deploy's SW immediately and take over open tabs, so the new
// precache manifest is served without waiting for every tab to close.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
    if (route.excludePaths && route.excludePaths.some((p) => url.pathname.startsWith(p))) return false
    if (route.pathPrefix && url.pathname.startsWith(route.pathPrefix)) return true
    if (route.origins && route.origins.includes(url.origin)) return true
    return false
  }
  registerRoute(match, new Strategy({ cacheName: route.cacheName, plugins }))
}

// SPA navigations → the precached app shell (instant + offline-capable).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// ── match-reminders push handlers go here (see web-push spec) ──────────────
