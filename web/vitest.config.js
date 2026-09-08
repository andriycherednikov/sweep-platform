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
  test: {
    environment: 'jsdom', globals: true, setupFiles: ['./test/setup.js'],
    // jsdom + React under a loaded machine regularly blows past vitest's 5s default,
    // and which test it hits is random — it was failing the pre-commit hook on files
    // nobody had touched. The api config sets 30s for the same reason. Nothing here
    // waits on real time; a test that takes 20s is a broken test, not a slow one.
    testTimeout: 20000,
  },
})
