/* ============================================================
   THE SWEEP — GA4 analytics. The ONLY contact with Google.
   Loads gtag.js in PRODUCTION BUILDS ONLY; a silent no-op in
   dev and tests, so nothing phones home there. The platform has
   no GA property of its own yet, so analytics stay OFF unless the
   build supplies VITE_GA_ID (a GA4 Measurement ID is public).
   ============================================================ */

const GA_ID = import.meta.env.VITE_GA_ID ?? ''

let initialized = false

export function initAnalytics() {
  if (initialized) return
  if (!import.meta.env.PROD || !GA_ID) return // dev/test/disabled → no network
  initialized = true

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() { window.dataLayer.push(arguments) }
  window.gtag('js', new Date())
  // send_page_view:false — SPA; we emit pageviews on route change.
  // (GA4 anonymizes IP by design — no explicit flag needed.)
  window.gtag('config', GA_ID, { send_page_view: false })
}

export function trackPageview(path) {
  try {
    if (!window.gtag) return
    // GA4 derives the page path from page_location; page_path is a
    // Universal Analytics param GA4 ignores, so we don't send it.
    window.gtag('event', 'page_view', {
      page_location: window.location.origin + path,
      page_title: document.title,
    })
  } catch { /* analytics must never break the app */ }
}

export function trackEvent(name, params = {}) {
  try {
    if (!window.gtag) return
    window.gtag('event', name, params)
  } catch { /* analytics must never break the app */ }
}
