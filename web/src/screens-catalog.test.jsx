import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Self-serve catalog: header-token auth via accountClient — mock it so these
// tests never touch fetch. The server is the filter/search; the component
// just re-queries it (no client-side filtering).
vi.mock('./lib/accountClient.js', () => ({
  getCatalog: vi.fn(),
  createSweep: vi.fn(),
}))
// LinkField pulls in the whole super console; stub it to keep this suite lean.
vi.mock('./screens-super.jsx', () => ({
  LinkField: ({ label, value }) => <input aria-label={label} readOnly value={value} />,
}))

import { CatalogScreen } from './screens-catalog.jsx'
import { getCatalog, createSweep } from './lib/accountClient.js'

const ROWS = [
  {
    provider: 'p', sport: 'football', leagueId: 'L1', name: 'Premier League', type: 'league',
    logo: 'https://x/pl.png', country: { name: 'England', code: 'EN', flag: null },
    seasons: [{ season: '2025-2026', current: true, start: '2025-08-15' }, { season: '2026-2027', current: false, start: '2099-09-01' }],
  },
  {
    provider: 'p', sport: 'basketball', leagueId: 'L2', name: 'NBA', type: 'league',
    logo: null, country: { name: 'USA' },
    seasons: [{ season: '2025', current: true, start: '2025-10-01' }, { season: '2026', current: false, start: '2026-01-01' }],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  getCatalog.mockResolvedValue(ROWS)
})

test('renders one card per provisionable season: logo null-guarded, name, country, when it runs', async () => {
  const { container } = render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  expect(await screen.findAllByText('Premier League')).toHaveLength(2)   // one card per season
  expect(screen.getAllByText('England')).toHaveLength(2)
  expect(screen.getAllByText('NBA')).toHaveLength(2)
  expect(screen.getAllByText('USA')).toHaveLength(2)
  expect(container.querySelectorAll('img')).toHaveLength(2) // NBA's null logo renders no <img>

  expect(screen.queryAllByRole('combobox')).toHaveLength(0) // seasons are stated, not chosen
  expect(screen.getByText('2025-2026')).toBeTruthy()
  expect(screen.getAllByText(/starts .*2099/i)).toHaveLength(1)
  expect(screen.getAllByText('in progress').length).toBeGreaterThan(0)
})

test('clicking a sport chip re-queries the server with that sport (not a client-side filter)', async () => {
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  await screen.findAllByText('Premier League')
  expect(getCatalog).toHaveBeenNthCalledWith(1, {})

  fireEvent.click(screen.getByRole('button', { name: /basketball/i }))
  await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(2))
  expect(getCatalog).toHaveBeenNthCalledWith(2, { sport: 'basketball' })
})

test('typing 1 character does not re-query; 2 characters triggers a query with q', async () => {
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  await screen.findAllByText('Premier League')
  expect(getCatalog).toHaveBeenCalledTimes(1)

  const input = screen.getByPlaceholderText(/search/i)
  fireEvent.change(input, { target: { value: 'n' } })
  await new Promise((r) => setTimeout(r, 400))
  expect(getCatalog).toHaveBeenCalledTimes(1)

  fireEvent.change(input, { target: { value: 'nb' } })
  await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(2), { timeout: 1000 })
  expect(getCatalog).toHaveBeenNthCalledWith(2, { q: 'nb' })
})

test('"Set up sweep" calls onPick with the row and that card\'s season', async () => {
  const onPick = vi.fn()
  render(<CatalogScreen onBack={() => {}} onPick={onPick} />)
  await screen.findAllByText('NBA')

  const buttons = screen.getAllByRole('button', { name: /set up sweep/i })
  fireEvent.click(buttons[3])   // NBA's second season card
  expect(onPick).toHaveBeenCalledWith(ROWS[1], '2026')
})

test('shows a loading line while the initial fetch is in flight', () => {
  getCatalog.mockReturnValue(new Promise(() => {}))
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  expect(screen.getByText(/loading/i)).toBeTruthy()
})

test('a failed fetch shows an inline error with a retry that re-queries', async () => {
  getCatalog.mockRejectedValueOnce(new Error('boom'))
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  expect(await screen.findByText(/something went wrong/i)).toBeTruthy()

  getCatalog.mockResolvedValueOnce(ROWS)
  fireEvent.click(screen.getByRole('button', { name: /retry/i }))
  expect(await screen.findAllByText('Premier League')).toBeTruthy()
})

test('an empty result set shows the "No competitions match." empty state', async () => {
  getCatalog.mockResolvedValue([])
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  expect(await screen.findByText('No competitions match.')).toBeTruthy()
})

/* ---- provision sheet (B2) ---- */

async function openSheet() {
  render(<CatalogScreen onBack={() => {}} />)
  await screen.findAllByText('NBA')
  fireEvent.click(screen.getAllByRole('button', { name: /set up sweep/i })[2])   // NBA's first season card
  return screen.getByPlaceholderText(/sweep name/i)
}

test('picking a league opens the provision sheet with a prefilled name and wagering OFF', async () => {
  const nameInput = await openSheet()
  expect(nameInput).toHaveValue('NBA 2025')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
})

test('submitting shows a pending state while the provision is in flight', async () => {
  createSweep.mockReturnValue(new Promise(() => {}))
  await openSheet()
  fireEvent.click(screen.getByRole('button', { name: /start sweep/i }))
  expect(await screen.findByText(/creating your sweep/i)).toBeTruthy()
  expect(screen.getByRole('button', { name: /start sweep/i })).toBeDisabled()
  expect(createSweep).toHaveBeenCalledWith({
    name: 'NBA 2025', provider: 'p', leagueId: 'L2', season: '2025', wageringEnabled: false,
  })
})

test('success shows the invite links and Done', async () => {
  createSweep.mockResolvedValue({ id: 'sw9', name: 'NBA 2025', memberLink: 'https://h/g/m9', adminLink: 'https://h/g/m9/admin/a9' })
  await openSheet()
  fireEvent.click(screen.getByRole('checkbox')) // wagering ON rides through
  fireEvent.click(screen.getByRole('button', { name: /start sweep/i }))
  expect(await screen.findByLabelText('Member link')).toHaveValue('https://h/g/m9')
  expect(screen.getByLabelText('Admin link')).toHaveValue('https://h/g/m9/admin/a9')
  expect(screen.getByRole('button', { name: /done/i })).toBeTruthy()
  expect(createSweep).toHaveBeenCalledWith(expect.objectContaining({ wageringEnabled: true }))
})

test('402 subscription_required maps to a billing CTA', async () => {
  createSweep.mockRejectedValue(Object.assign(new Error('subscription_required'), {
    status: 402, code: 'subscription_required', body: { error: 'subscription_required' },
  }))
  await openSheet()
  fireEvent.click(screen.getByRole('button', { name: /start sweep/i }))
  expect(await screen.findByText(/subscribe to start new sweeps/i)).toBeTruthy()
  expect(screen.getByRole('link', { name: /go to billing/i })).toHaveAttribute('href', '/account')
})

test('403 sweep_cap renders the cap when the body carries it', async () => {
  createSweep.mockRejectedValue(Object.assign(new Error('sweep_cap'), {
    status: 403, code: 'sweep_cap', body: { error: 'sweep_cap', cap: 3 },
  }))
  await openSheet()
  fireEvent.click(screen.getByRole('button', { name: /start sweep/i }))
  expect(await screen.findByText(/sweep limit \(3\)/i)).toBeTruthy()
})

test('400 unknown_competition and 500 map to their messages; 500 re-enables the button', async () => {
  createSweep.mockRejectedValueOnce(Object.assign(new Error('unknown_competition'), {
    status: 400, code: 'unknown_competition', body: { error: 'unknown_competition' },
  }))
  await openSheet()
  const btn = () => screen.getByRole('button', { name: /start sweep/i })
  fireEvent.click(btn())
  expect(await screen.findByText(/can't be set up right now/i)).toBeTruthy()

  createSweep.mockRejectedValueOnce(Object.assign(new Error('provision_failed'), {
    status: 500, code: 'provision_failed', body: { error: 'provision_failed' },
  }))
  fireEvent.click(btn())
  expect(await screen.findByText(/something went wrong — try again/i)).toBeTruthy()
  expect(btn()).not.toBeDisabled()
})
