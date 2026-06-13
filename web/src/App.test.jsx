import { expect, test, beforeEach, beforeAll, vi } from 'vitest'
import { render, act } from '@testing-library/react'

// jsdom does not implement scrollTo — stub it globally so ScheduleScreen's
// scroll-into-view effect does not throw when navigating to /schedule in tests.
beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = vi.fn()
  }
})

vi.mock('./lib/analytics.js', () => ({
  initAnalytics: vi.fn(), trackPageview: vi.fn(), trackEvent: vi.fn(),
}))
vi.mock('./api/client.js', () => ({ postWatch: vi.fn(async () => ({})), postSupport: vi.fn(async () => ({})) }))
vi.mock('./hooks/useEventStream.js', () => ({ useEventStream: vi.fn() }))
vi.mock('./admin.js', () => ({
  refreshAdminBadge: vi.fn(),
  useAdminBadge: vi.fn(() => ({ isAdmin: false, pending: 0 })),
}))

import App from './App.jsx'
import { initAnalytics, trackPageview } from './lib/analytics.js'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'

beforeEach(() => {
  localStorage.clear(); setMe(null); vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0c0', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', ko: '2026-06-20T18:00:00Z', t1: 'hr', t2: 'br', status: 'upcoming', group: 'A', stage: 'group', prob: null, score: null }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
})

test('mounts analytics and emits a pageview for the initial route', () => {
  render(<App />)
  expect(initAnalytics).toHaveBeenCalledTimes(1)
  expect(trackPageview).toHaveBeenCalledWith('/')
})

test('emits a pageview when the view changes (popstate navigation)', () => {
  render(<App />)
  trackPageview.mockClear()
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { tab: 'schedule', overlay: null, modal: null, identity: false },
    }))
  })
  expect(trackPageview).toHaveBeenCalledWith('/schedule')
})
