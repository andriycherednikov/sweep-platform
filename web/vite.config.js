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
