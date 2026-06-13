// vite-plugin-pwa options, factored out so they can be unit-tested without
// loading the plugin (vite.config.js imports and applies these).
export const pwaOptions = {
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.js',
  // Keep the hand-authored web/public/site.webmanifest; do not regenerate one.
  manifest: false,
  // 'prompt' + a register wrapper that never prompts/reloads => the new SW waits
  // and activates on the next cold launch (the chosen silent-next-launch lifecycle).
  registerType: 'prompt',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
  },
  devOptions: {
    enabled: true,
    type: 'module',
  },
}
