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
