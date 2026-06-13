// Stand-in for vite-plugin-pwa's generated `virtual:pwa-register` module.
// Used only under vitest (see resolve.alias in vitest.config.js).
import { vi } from 'vitest'

// registerSW(options) => updateSW(reloadPage?) ; we return a spy for both.
export const registerSW = vi.fn(() => vi.fn())
