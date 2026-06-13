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
