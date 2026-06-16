import { beforeEach, describe, expect, test, vi } from 'vitest'
import { registerSW } from 'virtual:pwa-register' // aliased to the stub
import { registerServiceWorker } from './registerSW.js'

describe('registerServiceWorker', () => {
  beforeEach(() => registerSW.mockClear())

  test('registers the service worker when supported', async () => {
    const nav = { serviceWorker: {} }
    await registerServiceWorker(nav)
    expect(registerSW).toHaveBeenCalledTimes(1)
    // immediate registration; no prompt (autoUpdate reloads on its own), and an
    // onRegisteredSW hook that keeps polling for a new deploy.
    const opts = registerSW.mock.calls[0][0] ?? {}
    expect(opts.immediate).toBe(true)
    expect(opts.onNeedRefresh).toBeUndefined()
    expect(typeof opts.onRegisteredSW).toBe('function')
  })

  test('onRegisteredSW schedules update checks and tolerates a missing registration', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0)
    try {
      await registerServiceWorker({ serviceWorker: {} })
      const { onRegisteredSW } = registerSW.mock.calls[0][0]
      expect(() => onRegisteredSW('/sw.js', undefined)).not.toThrow() // no registration → no-op
      const reg = { update: vi.fn(() => Promise.resolve()) }
      onRegisteredSW('/sw.js', reg)
      expect(interval).toHaveBeenCalled()
    } finally {
      interval.mockRestore()
    }
  })

  test('is a no-op when service workers are unsupported', async () => {
    const result = await registerServiceWorker({}) // no serviceWorker key
    expect(result).toBeNull()
    expect(registerSW).not.toHaveBeenCalled()
  })
})
