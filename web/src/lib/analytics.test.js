import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { initAnalytics, trackPageview, trackEvent } from './analytics.js'

beforeEach(() => {
  delete window.gtag
  delete window.dataLayer
  document.head.querySelectorAll('script[src*="googletagmanager"]').forEach((s) => s.remove())
})
afterEach(() => { vi.restoreAllMocks() })

test('initAnalytics is a no-op in the test env (PROD is false): no gtag, no script', () => {
  initAnalytics()
  expect(window.gtag).toBeUndefined()
  expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull()
})

test('trackEvent forwards name + params to window.gtag when present', () => {
  window.gtag = vi.fn()
  trackEvent('vote_cast', { pick: 'home', match_id: 'm1' })
  expect(window.gtag).toHaveBeenCalledWith('event', 'vote_cast', { pick: 'home', match_id: 'm1' })
})

test('trackEvent is a silent no-op when gtag is absent', () => {
  expect(() => trackEvent('vote_cast', { pick: 'home' })).not.toThrow()
})

test('trackPageview forwards a page_view event with the path', () => {
  window.gtag = vi.fn()
  trackPageview('/schedule')
  expect(window.gtag).toHaveBeenCalledWith(
    'event',
    'page_view',
    expect.objectContaining({ page_path: '/schedule' }),
  )
})

test('trackPageview swallows a throwing gtag (never breaks the app)', () => {
  window.gtag = () => { throw new Error('boom') }
  expect(() => trackPageview('/x')).not.toThrow()
})
