import { describe, expect, test } from 'vitest'
import { pwaOptions } from '../pwa.config.js'

describe('vite-plugin-pwa options', () => {
  test('uses injectManifest so we own the service worker source', () => {
    expect(pwaOptions.strategies).toBe('injectManifest')
    expect(pwaOptions.srcDir).toBe('src')
    expect(pwaOptions.filename).toBe('sw.js')
  })

  test('keeps the existing site.webmanifest (does not regenerate one)', () => {
    expect(pwaOptions.manifest).toBe(false)
  })

  test('uses the auto-update lifecycle so deploys propagate without closing tabs', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
  })

  test('precaches the app shell asset types', () => {
    const globs = pwaOptions.injectManifest.globPatterns.join(',')
    for (const ext of ['js', 'css', 'html', 'svg', 'png', 'ico', 'woff2']) {
      expect(globs).toContain(ext)
    }
  })

  test('excludes the oversized favicon.svg from the precache manifest', () => {
    expect(pwaOptions.injectManifest.globIgnores).toContain('**/favicon.svg')
  })

  test('enables the SW in dev so it can be exercised locally', () => {
    expect(pwaOptions.devOptions.enabled).toBe(true)
  })
})
