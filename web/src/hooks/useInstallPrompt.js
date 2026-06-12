// web/src/hooks/useInstallPrompt.js
import { useState, useEffect, useCallback } from 'react'

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

/**
 * Surfaces a custom install affordance. On Chromium we capture the deferred
 * `beforeinstallprompt` event and replay it from our own button; on iOS Safari
 * (which has no such API) we fall back to manual Add-to-Home-Screen instructions.
 * Hidden once installed or once the user dismisses it (persisted per device).
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(() => isStandalone())
  const [dismissed, setDismissed] = useState(readDismissed)

  useEffect(() => {
    const onBIP = (e) => { e.preventDefault(); setDeferred(e) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onBIP)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return null
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null) // a prompt event can only be used once
    return outcome // 'accepted' | 'dismissed'
  }, [deferred])

  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    setDismissed(true)
  }, [])

  const isIOS = detectIOS()
  const hasNativePrompt = !!deferred
  const canPrompt = !installed && !dismissed && (hasNativePrompt || isIOS)

  return { canPrompt, installed, dismissed, isIOS, hasNativePrompt, promptInstall, dismiss }
}
