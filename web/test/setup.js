// Pin the timezone so date/time formatting is deterministic in CI regardless of
// the machine's local zone. Production uses the viewer's real local zone.
process.env.TZ = 'Australia/Sydney'

import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement matchMedia; useIsDesktop relies on it (defaults to mobile in tests)
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })
}
