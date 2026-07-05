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
    seasons: [{ season: '2025-2026', current: true }, { season: '2024-2025', current: false }],
  },
  {
    provider: 'p', sport: 'basketball', leagueId: 'L2', name: 'NBA', type: 'league',
    logo: null, country: { name: 'USA' },
    seasons: [{ season: '2025', current: true }, { season: '2024', current: false }],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  getCatalog.mockResolvedValue(ROWS)
})

test('renders one row per league: logo null-guarded, name, country, season select defaults to the newest', async () => {
  const { container } = render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  expect(await screen.findByText('Premier League')).toBeTruthy()
  expect(screen.getByText('England')).toBeTruthy()
  expect(screen.getByText('NBA')).toBeTruthy()
  expect(screen.getByText('USA')).toBeTruthy()
  expect(container.querySelectorAll('img')).toHaveLength(1) // NBA's null logo renders no <img>

  const selects = screen.getAllByRole('combobox')
  expect(selects[0]).toHaveValue('2025-2026')
  expect(selects[1]).toHaveValue('2025')
})

test('clicking a sport chip re-queries the server with that sport (not a client-side filter)', async () => {
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  await screen.findByText('Premier League')
  expect(getCatalog).toHaveBeenNthCalledWith(1, {})

  fireEvent.click(screen.getByRole('button', { name: /basketball/i }))
  await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(2))
  expect(getCatalog).toHaveBeenNthCalledWith(2, { sport: 'basketball' })
})

test('typing 1 character does not re-query; 2 characters triggers a query with q', async () => {
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  await screen.findByText('Premier League')
  expect(getCatalog).toHaveBeenCalledTimes(1)

  const input = screen.getByPlaceholderText(/search/i)
  fireEvent.change(input, { target: { value: 'n' } })
  await new Promise((r) => setTimeout(r, 400))
  expect(getCatalog).toHaveBeenCalledTimes(1)

  fireEvent.change(input, { target: { value: 'nb' } })
  await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(2), { timeout: 1000 })
  expect(getCatalog).toHaveBeenNthCalledWith(2, { q: 'nb' })
})

test('"Set up sweep" calls onPick with the row and the selected season', async () => {
  const onPick = vi.fn()
  render(<CatalogScreen onBack={() => {}} onPick={onPick} />)
  await screen.findByText('NBA')

  const selects = screen.getAllByRole('combobox')
  fireEvent.change(selects[1], { target: { value: '2024' } })

  const buttons = screen.getAllByRole('button', { name: /set up sweep/i })
  fireEvent.click(buttons[1])
  expect(onPick).toHaveBeenCalledWith(ROWS[1], '2024')
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
  expect(await screen.findByText('Premier League')).toBeTruthy()
})

test('an empty result set shows the "No competitions match." empty state', async () => {
  getCatalog.mockResolvedValue([])
  render(<CatalogScreen onBack={() => {}} onPick={() => {}} />)
  expect(await screen.findByText('No competitions match.')).toBeTruthy()
})

/* ---- provision sheet (B2) ---- */

async function openSheet() {
  render(<CatalogScreen onBack={() => {}} />)
  await screen.findByText('NBA')
  fireEvent.click(screen.getAllByRole('button', { name: /set up sweep/i })[1])
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
  expect(await screen.findByText(/setting up — fetching teams and games/i)).toBeTruthy()
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
