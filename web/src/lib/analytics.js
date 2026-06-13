/* ============================================================
   THE SWEEP — GA4 analytics. The ONLY contact with Google.
   Loads gtag.js in PRODUCTION BUILDS ONLY; a silent no-op in
   dev and tests, so nothing phones home there. A GA4 Measurement
   ID is public (visible in any GA page's HTML), so it lives in
   source as a default; VITE_GA_ID overrides it ("" disables).
   ============================================================ */

const ENV_ID = import.meta.env.VITE_GA_ID
const GA_ID = ENV_ID === undefined ? 'G-6PZ0DXRS2D' : ENV_ID

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
  // send_page_view:false — this is an SPA; we emit pageviews ourselves on route change.
  window.gtag('config', GA_ID, { anonymize_ip: true, send_page_view: false })
}

export function trackPageview(path) {
  try {
    if (!window.gtag) return
    window.gtag('event', 'page_view', {
      page_path: path,
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
