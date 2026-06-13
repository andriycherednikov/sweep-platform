// web/src/hooks/useInstallPrompt.js
import { useSyncExternalStore } from 'react'
import { trackEvent } from '../lib/analytics.js'

const DISMISS_KEY = 'sweep:install-dismissed'

// Running as an installed PWA? (Android/desktop report via display-mode; iOS via navigator.standalone)
function isStandalone() {
  return !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone)
}

// iOS Safari never fires beforeinstallprompt — it only supports manual "Add to Home Screen".
function detectIOS() {
  const ua = window.navigator.userAgent || ''
  const iDevice = /iphone|ipad|ipod/i.test(ua)
  const iPadOS = /macintosh/i.test(ua) && (window.navigator.maxTouchPoints || 0) > 1
  return iDevice || iPadOS
}

function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/* ── Shared module-level store ────────────────────────────────────────────
   beforeinstallprompt fires once, early, possibly before the component that
   wants it has mounted. Capture it globally so any hook instance mounting
   later (e.g. the profile button on SPA navigation) still sees it. */
let deferredEvt = null
let installedViaEvent = false
let version = 0
let started = false
const listeners = new Set()

function emit() { version++; listeners.forEach((l) => l()) }

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredEvt = e; emit() })
  window.addEventListener('appinstalled', () => { installedViaEvent = true; deferredEvt = null; trackEvent('pwa_install'); emit() })
}
start() // listen from import time, before any component subscribes

function subscribe(cb) { start(); listeners.add(cb); return () => listeners.delete(cb) }
function getSnapshot() { return version } // primitive; changes only when state actually moves

async function promptInstall() {
  if (!deferredEvt) return null
  deferredEvt.prompt()
  const { outcome } = await deferredEvt.userChoice
  deferredEvt = null // a prompt event can only be used once
  emit()
  return outcome // 'accepted' | 'dismissed'
}

function dismiss() {
  try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
  emit()
}

// test-only: reset the shared store between cases
export function __resetInstallStore() { deferredEvt = null; installedViaEvent = false; emit() }

/**
 * Surfaces a custom install affordance. Derived flags are computed live each
 * render (cheap, navigator-based) while the captured event lives in the shared
 * store above, so the button works whether it mounts before or after the event.
 */
export function useInstallPrompt() {
  useSyncExternalStore(subscribe, getSnapshot) // re-render when the shared store changes

  const isIOS = detectIOS()
  const installed = isStandalone() || installedViaEvent
  const dismissed = readDismissed()
  const hasNativePrompt = !!deferredEvt
  // Installable at all on this device (backs an explicit "Install" button).
  const canInstall = !installed && (hasNativePrompt || isIOS)
  // Whether the auto-banner should appear (same, but respects a prior dismissal).
  const canPrompt = canInstall && !dismissed

  return { canPrompt, canInstall, installed, dismissed, isIOS, hasNativePrompt, promptInstall, dismiss }
}
