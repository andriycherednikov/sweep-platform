// Thin wrapper around vite-plugin-pwa's virtual register module.
// No options => the new SW waits and activates on the next cold launch
// (no prompt, no auto-reload). Feature-detected so a non-PWA browser is unaffected.
export async function registerServiceWorker(nav = globalThis.navigator) {
  if (!nav || !('serviceWorker' in nav)) return null
  const { registerSW } = await import('virtual:pwa-register')
  return registerSW({ immediate: true })
}
