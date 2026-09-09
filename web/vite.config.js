import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config.js'

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions)],
  server: {
    host: '127.0.0.1', // ::1-only default breaks 127.0.0.1 browsing (platform-mode cookie isolation)
    // 127.0.0.1, not localhost: the api binds 127.0.0.1, while `localhost` resolves to
    // ::1 first on this machine — so any other project holding [::1]:3000 silently
    // swallows every /api call and the SPA looks broken for no visible reason.
    // Nothing reads the Host header any more (the auth rebuild removed that fork), so
    // the target's host no longer has to match anything.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/photos': 'http://127.0.0.1:3000', // approved photos are served by the api (Caddy in prod)
    },
  },
})
