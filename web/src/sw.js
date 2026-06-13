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
