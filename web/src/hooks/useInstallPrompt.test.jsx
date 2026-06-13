// web/src/hooks/useInstallPrompt.test.jsx
import { expect, test, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInstallPrompt, __resetInstallStore } from './useInstallPrompt.js'

vi.mock('../lib/analytics.js', () => ({ trackEvent: vi.fn() }))
import { trackEvent } from '../lib/analytics.js'

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile'
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'

function setUA(ua) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}
function setStandalone(matches) {
  window.matchMedia = (q) => ({ matches, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} })
}
function fireBIP() {
  const e = new Event('beforeinstallprompt')
  e.prompt = vi.fn()
  e.userChoice = Promise.resolve({ outcome: 'accepted' })
  window.dispatchEvent(e)
  return e
}

beforeEach(() => {
  localStorage.clear()
  setUA(UA_ANDROID)
  setStandalone(false)
  delete window.navigator.standalone
  __resetInstallStore()
})

test('captures beforeinstallprompt and exposes a native prompt', () => {
  const { result } = renderHook(() => useInstallPrompt())
  expect(result.current.canPrompt).toBe(false) // no event yet, not iOS
  act(() => { fireBIP() })
  expect(result.current.hasNativePrompt).toBe(true)
  expect(result.current.canPrompt).toBe(true)
})

test('prevents the browser mini-infobar by calling preventDefault', () => {
  renderHook(() => useInstallPrompt())
  const e = new Event('beforeinstallprompt')
  e.prompt = vi.fn(); e.userChoice = Promise.resolve({ outcome: 'dismissed' })
  const spy = vi.spyOn(e, 'preventDefault')
  act(() => { window.dispatchEvent(e) })
  expect(spy).toHaveBeenCalled()
})

test('promptInstall() triggers the deferred event and returns the outcome', async () => {
  const { result } = renderHook(() => useInstallPrompt())
  let evt
  act(() => { evt = fireBIP() })
  let outcome
  await act(async () => { outcome = await result.current.promptInstall() })
  expect(evt.prompt).toHaveBeenCalled()
  expect(outcome).toBe('accepted')
  expect(result.current.hasNativePrompt).toBe(false) // event consumed
})

test('iOS Safari can prompt (manual instructions) without a native event', () => {
  setUA(UA_IOS)
  const { result } = renderHook(() => useInstallPrompt())
  expect(result.current.isIOS).toBe(true)
  expect(result.current.hasNativePrompt).toBe(false)
  expect(result.current.canPrompt).toBe(true)
})

test('already-installed (standalone) never prompts', () => {
  setStandalone(true)
  const { result } = renderHook(() => useInstallPrompt())
  act(() => { fireBIP() })
  expect(result.current.installed).toBe(true)
  expect(result.current.canPrompt).toBe(false)
})

test('canInstall ignores dismissal (it backs an explicit button)', () => {
  const { result } = renderHook(() => useInstallPrompt())
  act(() => { fireBIP() })
  act(() => { result.current.dismiss() })
  expect(result.current.canPrompt).toBe(false) // banner suppressed
  expect(result.current.canInstall).toBe(true) // explicit button still offered
})

test('canInstall is false once installed', () => {
  setStandalone(true)
  const { result } = renderHook(() => useInstallPrompt())
  act(() => { fireBIP() })
  expect(result.current.canInstall).toBe(false)
})

test('an appinstalled event emits the pwa_install analytics event', () => {
  trackEvent.mockClear()
  window.dispatchEvent(new Event('appinstalled'))
  expect(trackEvent).toHaveBeenCalledWith('pwa_install')
})

test('dismiss() persists and suppresses the prompt', () => {
  const { result } = renderHook(() => useInstallPrompt())
  act(() => { fireBIP() })
  act(() => { result.current.dismiss() })
  expect(result.current.canPrompt).toBe(false)
  // a fresh mount stays dismissed
  const second = renderHook(() => useInstallPrompt())
  act(() => { fireBIP() })
  expect(second.result.current.canPrompt).toBe(false)
})
