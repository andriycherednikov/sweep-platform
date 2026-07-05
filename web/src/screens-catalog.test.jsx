import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Self-serve catalog: header-token auth via accountClient — mock it so these
// tests never touch fetch. The server is the filter/search; the component
// just re-queries it (no client-side filtering).
vi.mock('./lib/accountClient.js', () => ({
  getCatalog: vi.fn(),
}))

import { CatalogScreen } from './screens-catalog.jsx'
import { getCatalog } from './lib/accountClient.js'

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
