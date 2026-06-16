// Thin wrapper around vite-plugin-pwa's virtual register module.
// 'autoUpdate' lifecycle: a new deploy's SW skips waiting + claims clients
// (src/sw.js), and the plugin reloads the page onto the latest build. We also
// poll for a new SW periodically and when the tab regains focus, so a long-open
// SPA (which never triggers a real navigation) still picks up a deploy without a
// manual refresh. Feature-detected so a non-PWA browser is unaffected.

const UPDATE_INTERVAL_MS = 30 * 60 * 1000 // re-check for a new SW every 30 min

export async function registerServiceWorker(nav = globalThis.navigator) {
  if (!nav || !('serviceWorker' in nav)) return null
  const { registerSW } = await import('virtual:pwa-register')
  return registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      const check = () => { registration.update().catch(() => {}) }
      setInterval(check, UPDATE_INTERVAL_MS)
      globalThis.addEventListener?.('visibilitychange', () => {
        if (globalThis.document?.visibilityState === 'visible') check()
      })
    },
  })
}
