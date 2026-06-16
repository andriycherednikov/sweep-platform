// vite-plugin-pwa options, factored out so they can be unit-tested without
// loading the plugin (vite.config.js imports and applies these).
export const pwaOptions = {
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.js',
  // Keep the hand-authored web/public/site.webmanifest; do not regenerate one.
  manifest: false,
  // 'autoUpdate': a new deploy's SW skips waiting + claims clients (see src/sw.js)
  // and the page reloads onto the latest build, so users aren't stuck on a stale
  // precached bundle until they close every tab.
  registerType: 'autoUpdate',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
    // favicon.svg is 3.4 MB (embedded raster data) — exclude it from the precache
    // manifest; browsers cache it independently via <link rel="icon">.
    globIgnores: ['**/favicon.svg'],
  },
  devOptions: {
    enabled: true,
    type: 'module',
  },
}
