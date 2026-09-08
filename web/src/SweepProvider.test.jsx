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
  '/api/social': { support: {} },
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

test('takes its identity from bootstrap, not from this device', async () => {
  // Fresh module graph (like the 401 tests below) so the gate's ['sweep'] query
  // actually re-runs instead of returning the cached result of the earlier tests.
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    if (path === '/api/bootstrap') {
      return { ok: true, status: 200, json: async () => ({
        teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }],
        people: [{ id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null }],
        ownership: {}, scoring: { rule: 'top3' }, sweep: { id: 'sw_x', name: 'X Sweep' },
        meId: 'p1',
      }) }
    }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
  const { SweepProvider } = await import('./SweepProvider.jsx')
  const { getMe } = await import('./social.js')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  // resolved against S.people, so it still carries `teams` for the screens that read it
  expect(getMe()?.id).toBe('p1')
  expect(getMe()?.teams).toEqual([])
  expect(Object.keys(localStorage).some((k) => k.startsWith('sweep.me.'))).toBe(false)
})

function mock401() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
    if (path === '/api/bootstrap') return { ok: false, status: 401, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
}

test('a change of identity refetches the wallet', async () => {
  vi.resetModules()
  localStorage.clear()
  // The wallet is whoever the session is, so the URL no longer names anyone: what we
  // can assert is that changing identity re-keys the query and asks again.
  const balances = [100, 777]
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
        meId: 'p1',
      }) }
    }
    if (path === '/api/coins') {
      expect(url).not.toContain('personId')
      const balance = balances[Math.min(coinsCalls.length, balances.length - 1)]
      coinsCalls.push(url)
      return { ok: true, status: 200, json: async () => ({ balance, bets: { open: [], settled: [] }, parlays: { open: [], settled: [] } }) }
    }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
  const { SweepProvider } = await import('./SweepProvider.jsx')
  const { setMe } = await import('./social.js')
  const { myWallet } = await import('./coins.js')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(myWallet().balance).toBe(100))

  const before = coinsCalls.length
  setMe('p2')
  await waitFor(() => expect(coinsCalls.length).toBeGreaterThan(before))
  await waitFor(() => expect(myWallet().balance).toBe(777))
})

// A visitor with no session and no sweeps on this device is a STRANGER, not a
// locked-out member: the platform root is the product's front door, so it sells
// the thing and routes to sign-up — the invite path is the aside, not the answer.
test('a 401 with no stored sweeps → the product landing, not the member picker', async () => {
  vi.resetModules()
  localStorage.clear()
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByTestId('sweep-landing')).toBeInTheDocument())
  expect(screen.queryByText('app-ready')).toBeNull()
  expect(screen.queryByTestId('sweep-pick')).toBeNull()
  const starts = screen.getAllByRole('link', { name: /start free/i })
  expect(starts.length).toBeGreaterThan(0)
  starts.forEach((a) => expect(a).toHaveAttribute('href', '/account?signup'))
  expect(screen.getByText(/invite link/i)).toBeInTheDocument() // members still told what to do
})

// A dead invite link (rotated, archived, typo'd) is the one case where the stranger
// is NOT a stranger — they were sent here on purpose. Selling them the product answers
// nothing; tell them the link is dead so they go ask the organiser for a fresh one.
test('a 401 after a failed join → the dead-link card, not the landing', async () => {
  vi.resetModules()
  localStorage.clear()
  window.history.replaceState({}, '', '/?join=failed')
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByTestId('sweep-join-failed')).toBeInTheDocument())
  expect(screen.queryByTestId('sweep-landing')).toBeNull()
  window.history.replaceState({}, '', '/')
})

// The root is the front door now, for everyone: a member who has joined five sweeps
// still gets the product page there, not a picker. Their sweeps live at /switch, which
// the landing nav links to. This is the whole point of giving sweeps their own path.
test('a 401 at the root shows the landing even when this device holds sweeps', async () => {
  vi.resetModules()
  localStorage.clear()
  vi.doMock('./sweeps.js', async (orig) => ({ ...(await orig()),
    listSweeps: () => [{ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' }],
    addSweep: vi.fn(),
  }))
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByTestId('sweep-landing')).toBeInTheDocument())
  expect(screen.queryByTestId('sweep-pick')).toBeNull()
  expect(screen.queryByText('Pub Sweep')).toBeNull()
})

// A bookmarked sweep outliving its 8h cookie is the common case, and the device still
// holds the link token — spend it once rather than sending them back to the organiser.
test('a 401 on a sweep path re-exchanges that sweep\'s stored token once', async () => {
  vi.resetModules()
  localStorage.clear()
  window.history.replaceState({}, '', '/s/sw_1')
  const postSession = vi.fn(async () => ({ sweepId: 'sw_1', role: 'member' }))
  vi.doMock('./sweeps.js', async (orig) => ({ ...(await orig()),
    listSweeps: () => [{ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' }],
    addSweep: vi.fn(),
  }))
  mock401()
  vi.doMock('./api/client.js', async (orig) => ({ ...(await orig()), postSession }))
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(postSession).toHaveBeenCalledWith('tok1'))
  window.history.replaceState({}, '', '/')
})

// The sweep cookie is 8h; the account session behind it is 90d. An owner opening their
// own bookmark on a new phone (no stored link token at all, unlike the case above) must
// not be told to go find their invite link — this is the common case, not an edge one.
test('a 401 on a sweep this signed-in account owns navigates straight to its member link', async () => {
  vi.resetModules()
  localStorage.clear()
  window.history.replaceState({}, '', '/s/sw_owned')
  vi.doMock('./sweeps.js', async (orig) => ({ ...(await orig()), listSweeps: () => [], addSweep: vi.fn() }))
  const getAccountSweeps = vi.fn(async () => ([{ id: 'sw_owned', name: 'Office', memberLink: 'https://h/g/mem_owned' }]))
  vi.doMock('./lib/accountClient.js', async (orig) => ({ ...(await orig()), getAccountToken: () => 'acct_tok_1', getAccountSweeps }))
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  const originalLocation = window.location
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, assign: vi.fn() },
    configurable: true, writable: true,
  })
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://h/g/mem_owned'))
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true })
  window.history.replaceState({}, '', '/')
})

// A signed-in account that does not own this sweep gets no special treatment: it falls
// straight through to the ordinary stored-token / needs-invite path below.
test('a 401 on a sweep this signed-in account does not own falls through to the invite card', async () => {
  vi.resetModules()
  localStorage.clear()
  window.history.replaceState({}, '', '/s/sw_someone_else')
  vi.doMock('./sweeps.js', async (orig) => ({ ...(await orig()), listSweeps: () => [], addSweep: vi.fn() }))
  const getAccountSweeps = vi.fn(async () => ([]))
  vi.doMock('./lib/accountClient.js', async (orig) => ({ ...(await orig()), getAccountToken: () => 'acct_tok_1', getAccountSweeps }))
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(getAccountSweeps).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByTestId('sweep-needs-invite')).toBeInTheDocument())
  window.history.replaceState({}, '', '/')
})

// Someone else's sweep id, or ours with the token gone: one card either way, so the id
// cannot be probed to learn which sweeps exist.
test('a 401 on a sweep path with no stored token asks for the invite link', async () => {
  vi.resetModules()
  localStorage.clear()
  window.history.replaceState({}, '', '/s/sw_someone_else')
  vi.doMock('./sweeps.js', async (orig) => ({ ...(await orig()), listSweeps: () => [], addSweep: vi.fn() }))
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByTestId('sweep-needs-invite')).toBeInTheDocument())
  expect(screen.queryByTestId('sweep-landing')).toBeNull()
  window.history.replaceState({}, '', '/')
})

test('a successful load backfills the sweep name into the store via addSweep', async () => {
  vi.resetModules()
  localStorage.clear()
  const addSweep = vi.fn()
  vi.doMock('./sweeps.js', async (orig) => ({ ...(await orig()), listSweeps: () => [], addSweep, switchTo: vi.fn() }))
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

// Devices that joined by an ADMIN link before this branch stored that admin token here,
// and POST /api/session matches the member token only — so their rejoin 404s, and used
// to leave the gate spinning with the dead token still stored, retried on every visit.
// A rejected token is forgotten once, and the card says what actually happened.
test('a 401 on a sweep whose stored token the server rejects forgets it and says so', async () => {
  vi.resetModules()
  localStorage.clear()
  window.history.replaceState({}, '', '/s/sw_1')
  // the real store, in miniature: dropToken is what must be called, and the next
  // render must see the token gone
  let stored = [{ sweepId: 'sw_1', name: 'Pub Sweep', role: 'admin', token: 'admin-tok' }]
  const dropToken = vi.fn((id) => { stored = stored.map((s) => (s.sweepId === id ? { ...s, token: null } : s)) })
  vi.doMock('./sweeps.js', async (orig) => ({
    ...(await orig()), listSweeps: () => stored, addSweep: vi.fn(), dropToken,
  }))
  // 404: no link matches this token — which is what the API says to an admin token
  // now that POST /api/session matches the member token only.
  const postSession = vi.fn(async () => {
    throw Object.assign(new Error('POST /api/session failed: HTTP 404'), { status: 404 })
  })
  vi.doMock('./api/client.js', async (orig) => ({ ...(await orig()), postSession }))
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText(/saved link stopped working/i)).toBeInTheDocument())
  // recoverable, not terminal: it names the fix, and never claims the sweep is gone
  expect(screen.getByText(/ask whoever runs the sweep for the current link/i)).toBeInTheDocument()
  expect(dropToken).toHaveBeenCalledWith('sw_1')
  expect(postSession).toHaveBeenCalledTimes(1) // dropped, not retried forever
  window.history.replaceState({}, '', '/')
})
