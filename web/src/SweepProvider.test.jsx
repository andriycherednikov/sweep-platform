import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SweepProvider } from './SweepProvider.jsx'
import { SWEEP } from './data.js'

let esInstances = []
class FakeES { constructor(url){ this.url = url; this.onmessage = null; this.onopen = null; esInstances.push(this) } close(){} }
vi.stubGlobal('EventSource', FakeES)

const bundle = {
  '/api/bootstrap': { teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }], people: [], ownership: {}, scoring: { rule: 'top3' } },
  '/api/fixtures': [], '/api/standings': { L: [] }, '/api/photos': [],
  '/api/sync-status': { stale: true, lastBaselineAt: null, lastLiveAt: null },
  '/api/social': { watch: {}, support: {} },
  '/api/coins': { balance: 1000, bets: [] },
}

beforeEach(() => {
  esInstances = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
})

test('shows a loading state, then renders children with data populated', async () => {
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  expect(screen.getByTestId('sweep-loading')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(SWEEP.team('hr').name).toBe('Croatia')
  // stale sync no longer surfaces a banner (removed) even when syncStatus.stale === true
  expect(screen.queryByTestId('stale-banner')).toBeNull()
})

test('subscribes to the SSE stream on mount', async () => {
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(esInstances[0]?.url).toBe('/api/stream')
})

test('sets the active sweep id from bootstrap so identity keys per-sweep', async () => {
  // Fresh module graph (like the 401 tests below) so the gate's ['sweep'] query
  // actually re-runs instead of returning the cached result of the earlier tests.
  vi.resetModules()
  localStorage.clear()
  // a pick stored under sw_x must resolve once the gate sets the active sweep id
  localStorage.setItem('sweep.me.v1.sw_x', 'p1')
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    if (path === '/api/bootstrap') {
      return { ok: true, status: 200, json: async () => ({
        teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }],
        people: [{ id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null }],
        ownership: {}, scoring: { rule: 'top3' }, sweep: { id: 'sw_x', name: 'X Sweep' },
      }) }
    }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
  const { SweepProvider } = await import('./SweepProvider.jsx')
  const { getMe } = await import('./social.js')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(getMe()?.id).toBe('p1')
})

function mock401() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    if (path === '/api/bootstrap') return { ok: false, status: 401, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
}

test('switching identity refetches the wallet for the newly-viewed person', async () => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sweep.me.v1.sw_x', 'p1')
  // per-person balances so we can tell whose wallet is loaded
  const balByPerson = { p1: 100, p2: 777 }
  const coinsCalls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    if (path === '/api/bootstrap') {
      return { ok: true, status: 200, json: async () => ({
        teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }],
        people: [
          { id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null },
          { id: 'p2', name: 'B', short: 'B', initials: 'B', av: '#000', avatarPath: null },
        ],
        ownership: {}, scoring: { rule: 'top3' }, sweep: { id: 'sw_x', name: 'X Sweep' },
      }) }
    }
    if (path === '/api/coins') {
      const pid = new URL(url, 'http://x').searchParams.get('personId')
      coinsCalls.push(pid)
      return { ok: true, status: 200, json: async () => ({ balance: balByPerson[pid] ?? 0, bets: { open: [], settled: [] }, parlays: { open: [], settled: [] } }) }
    }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
  const { SweepProvider } = await import('./SweepProvider.jsx')
  const { setMe } = await import('./social.js')
  const { myWallet } = await import('./coins.js')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(myWallet().balance).toBe(100))

  setMe('p2')
  await waitFor(() => expect(coinsCalls).toContain('p2'))
  await waitFor(() => expect(myWallet().balance).toBe(777))
})

test('a 401 on bootstrap with no stored sweeps → "invite link needed" empty state', async () => {
  vi.resetModules()
  localStorage.clear()
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByTestId('sweep-pick')).toBeInTheDocument())
  expect(screen.queryByText('app-ready')).toBeNull()
  expect(screen.queryByTestId('sweep-error')).toBeNull()
  expect(screen.getByText(/invite link/i)).toBeInTheDocument()
})

test('a 401 with stored sweeps → tappable list; tap calls switchTo(sweep, queryClient)', async () => {
  vi.resetModules()
  localStorage.clear()
  const switchTo = vi.fn(async () => {})
  vi.doMock('./sweeps.js', () => ({
    listSweeps: () => [{ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' }],
    addSweep: vi.fn(),
    switchTo,
  }))
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  const btn = await screen.findByRole('button', { name: /Pub Sweep/i })
  fireEvent.click(btn)
  expect(switchTo).toHaveBeenCalledTimes(1)
  expect(switchTo.mock.calls[0][0]).toEqual({ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' })
  expect(switchTo.mock.calls[0][1]).toHaveProperty('invalidateQueries')
})

test('a successful load backfills the sweep name into the store via addSweep', async () => {
  vi.resetModules()
  localStorage.clear()
  const addSweep = vi.fn()
  vi.doMock('./sweeps.js', () => ({ listSweeps: () => [], addSweep, switchTo: vi.fn() }))
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    if (path === '/api/bootstrap') {
      return { ok: true, status: 200, json: async () => ({ ...bundle['/api/bootstrap'], sweep: { id: 'sw_9', name: 'Office Sweep' } }) }
    }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(addSweep).toHaveBeenCalledWith({ sweepId: 'sw_9', name: 'Office Sweep', role: 'member', token: null })
})
