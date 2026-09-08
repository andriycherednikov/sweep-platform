import { expect, test, beforeEach, beforeAll, vi } from 'vitest'
import { render, act, screen, waitFor } from '@testing-library/react'

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
vi.mock('./api/client.js', () => ({
  postSupport: vi.fn(async () => ({})),
  fetchSuperSweeps: vi.fn(async () => ([])),
  archiveSweep: vi.fn(async () => ({})),
  unarchiveSweep: vi.fn(async () => ({})),
  patchSweep: vi.fn(async () => ({})),
}))
vi.mock('./hooks/useEventStream.js', () => ({ useEventStream: vi.fn() }))
// useAdminBadge is a render-enabler, not part of the analytics assertions:
// HomeHeader calls it during render (like the scrollTo polyfill above for ScheduleScreen).
vi.mock('./admin.js', () => ({
  refreshAdminBadge: vi.fn(),
  useAdminBadge: vi.fn(() => ({ isAdmin: false, pending: 0 })),
}))

import App, { urlFor, readView, tabsFor } from './App.jsx'
import * as client from './api/client.js'
import { initAnalytics, trackPageview, trackEvent } from './lib/analytics.js'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'
import { addSweep } from './sweeps.js'
import { makeApi, makeBootstrap } from '../test/factories.js'

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
  setSocialData({ support: {} })
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

test('emits match_open when a match card is opened', () => {
  const { container } = render(<App />)
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { tab: 'schedule', overlay: null, modal: null, identity: false },
    }))
  })
  const card = container.querySelector('.card')
  expect(card).not.toBeNull()
  act(() => { card.click() })
  expect(trackEvent).toHaveBeenCalledWith('match_open', { match_id: 'm1' })
})

test('navigating to /sweeps opens the My-sweeps switcher overlay', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  render(<App />)
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { tab: 'home', overlay: { type: 'sweeps' }, modal: null, identity: false },
    }))
  })
  expect(screen.getByText('My sweeps')).toBeInTheDocument()
  expect(screen.getByText('Office')).toBeInTheDocument()
})

test('opening /super renders the SuperConsole with no token prompt', async () => {
  window.history.replaceState(null, '', '/super')
  const { findByText, queryByPlaceholderText } = render(<App />)
  // an operator account session, not a token: the console just lists (mock resolves empty)
  expect(await findByText(/no sweeps yet/i)).toBeTruthy()
  expect(queryByPlaceholderText(/token/i)).toBeNull()
})

test('readView maps /super/<token> to the super overlay (the token rides along, unused by the console)', () => {
  // /super/<token> must still resolve to the super overlay — main.jsx relies on this to
  // strip the token from the URL on load, even though SuperConsole no longer submits it.
  expect(readView('/super/sekret')).toMatchObject({ overlay: { type: 'super', token: 'sekret' } })
})

test('urlFor never includes the super token (analytics + history never see it)', () => {
  // The token lives only in the in-memory view; the emitted URL is always bare /super.
  expect(urlFor({ tab: 'home', overlay: { type: 'super', token: 'sekret' } })).toBe('/super')
  expect(urlFor({ tab: 'home', overlay: { type: 'super', token: null } })).toBe('/super')
})

test('mounting /super/<token> strips the token from the URL; the console loads on the account session, not the token', async () => {
  window.history.replaceState(null, '', '/super/sekret')
  render(<App />)
  // token is gone from the address bar immediately (no lingering secret, no GA leak)
  expect(window.location.pathname).toBe('/super')
  expect(window.location.href).not.toContain('sekret')
  // ...and the console never sees or uses it — it just lists on whatever session exists
  await waitFor(() => expect(client.fetchSuperSweeps).toHaveBeenCalled())
})

test('the super pageview path sent to analytics excludes the token', async () => {
  window.history.replaceState(null, '', '/super/sekret')
  render(<App />)
  await waitFor(() => expect(trackPageview).toHaveBeenCalled())
  // every pageview path for the super route must be bare /super
  for (const call of trackPageview.mock.calls) {
    expect(call[0]).not.toContain('sekret')
  }
  expect(trackPageview).toHaveBeenCalledWith('/super')
})

test('readView maps /wagers to the coins tab and urlFor round-trips (wire key stays "coins", route is web-local)', () => {
  expect(readView('/wagers')).toMatchObject({ tab: 'coins' })
  expect(urlFor({ tab: 'coins' })).toBe('/wagers')
  // no legacy alias: the old /coins path is not a route
  expect(readView('/coins')).toMatchObject({ tab: 'home' })
})

test('league competitions have no knockouts tab or route', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))
  expect(tabsFor()).not.toContain('knockouts')
  expect(readView('/knockouts').tab).toBe('home')   // route falls back
})

test('cup competitions keep knockouts', () => {
  setSweepData(assembleSweep(makeApi()))
  expect(tabsFor()).toContain('knockouts')
})

test('wageringEnabled:false drops the coins tab and pins /wagers to home', () => {
  setSweepData(assembleSweep(makeApi({ bootstrap: makeBootstrap({ wageringEnabled: false }) })))
  expect(tabsFor()).not.toContain('coins')
  expect(readView('/wagers').tab).toBe('home')
})

test('readOnly banner renders when the sweep is read-only', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0c0', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null, readOnly: true,
    },
    fixtures: [{ id: 'm1', ko: '2026-06-20T18:00:00Z', t1: 'hr', t2: 'br', status: 'upcoming', group: 'A', stage: 'group', prob: null, score: null }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  render(<App />)
  expect(screen.getByText(/read-only/i)).toBeInTheDocument()
})

// A sweep is a place now, so every URL inside one names it. Old one-arg calls keep
// producing bare paths, which is what the default sweep (the community app, one
// sweep per host) still wants — only a token sweep has an id worth carrying.
test('urlFor prefixes the sweep path when given an id, and stays bare without one', () => {
  expect(urlFor({ tab: 'standings' }, 'sw_x')).toBe('/s/sw_x/standings')
  expect(urlFor({ tab: 'home' }, 'sw_x')).toBe('/s/sw_x')
  expect(urlFor({ tab: 'coins' }, 'sw_x')).toBe('/s/sw_x/wagers')
  expect(urlFor({ tab: 'home', overlay: { type: 'team', code: 'hr' } }, 'sw_x')).toBe('/s/sw_x/teams/hr')
  expect(urlFor({ tab: 'standings' })).toBe('/standings')
  expect(urlFor({ tab: 'standings' }, 'default')).toBe('/standings')
})

// The super token is the platform master credential; prefixing must not resurrect it.
test('urlFor still refuses to emit the super token, sweep-scoped or not', () => {
  expect(urlFor({ tab: 'home', overlay: { type: 'super', token: 'sekret' } }, 'sw_x')).toBe('/super')
})

test('readView reads through the sweep prefix, so every old route still parses', () => {
  expect(readView('/s/sw_x/wagers')).toMatchObject(readView('/wagers'))
  expect(readView('/s/sw_x/standings')).toMatchObject(readView('/standings'))
  expect(readView('/s/sw_x/teams/hr')).toMatchObject(readView('/teams/hr'))
  expect(readView('/s/sw_x')).toMatchObject(readView('/'))
})
