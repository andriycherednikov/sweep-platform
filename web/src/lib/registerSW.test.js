import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { registerSW } from 'virtual:pwa-register' // aliased to the stub
import { registerServiceWorker } from './registerSW.js'

describe('registerServiceWorker', () => {
  beforeEach(() => registerSW.mockClear())
  afterEach(() => { delete globalThis.__nav })

  test('registers the service worker when supported', async () => {
    const nav = { serviceWorker: {} }
    await registerServiceWorker(nav)
    expect(registerSW).toHaveBeenCalledTimes(1)
    // immediate registration, no auto-reload handlers (next-launch lifecycle)
    const opts = registerSW.mock.calls[0][0] ?? {}
    expect(opts.onNeedRefresh).toBeUndefined()
    expect(opts.onRegisteredSW).toBeUndefined()
  })

  test('is a no-op when service workers are unsupported', async () => {
    const result = await registerServiceWorker({}) // no serviceWorker key
    expect(result).toBeNull()
    expect(registerSW).not.toHaveBeenCalled()
  })
})
