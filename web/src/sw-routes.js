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
//   excludePaths - paths under pathPrefix the SW must NOT handle (optional)
//   maxEntries   - ExpirationPlugin cap (optional)
//   maxAgeSeconds- ExpirationPlugin TTL (optional)
export const SW_ROUTES = [
  {
    id: 'api',
    strategy: 'NetworkFirst',
    cacheName: 'sweep-api',
    pathPrefix: '/api',
    excludePaths: ['/api/stream'], // never intercept the SSE EventSource stream
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
