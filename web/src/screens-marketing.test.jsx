import { expect, test, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Landing } from './screens-landing.jsx'
import { Pricing } from './screens-pricing.jsx'

/* The split is deliberate: the front page sells the ritual, the top bar is where
   someone goes to find out what it costs. Keep the price off the landing. */

test('the landing routes to pricing from the nav instead of quoting a price', () => {
  render(<Landing />)
  expect(screen.getAllByRole('link', { name: /pricing/i })[0]).toHaveAttribute('href', '/pricing')
  expect(document.body.textContent).not.toMatch(/\$\s?\d/)
})

test('the landing leads with the free trial, not the card', () => {
  render(<Landing />)
  screen.getAllByRole('link', { name: /start free/i }).forEach((a) => expect(a).toHaveAttribute('href', '/account'))
  expect(screen.getAllByText(/no card/i).length).toBeGreaterThan(0)
})

test('the pricing page carries the price and the same start action', () => {
  render(<Pricing />)
  expect(screen.getByText(/\$5/)).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: /start free/i })[0]).toHaveAttribute('href', '/account')
})

/* The rail is the page's one live element: real finished games, winner first. An
   empty or unreachable feed must leave no empty scoreboard behind. */
afterEach(() => { vi.unstubAllGlobals() })

const RESULT = {
  id: 'ev1', competition: 'NBA', sport: 'basketball', playedAt: '2026-08-01T00:00:00Z',
  home: { name: 'Mavericks', score: 88, won: false },
  away: { name: 'Celtics', score: 108, won: true },
}

test('the results rail leads with the winner', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [RESULT] })))
  render(<Landing />)
  const rail = await screen.findByLabelText('Recent results')
  // winner's name and score come before the loser's in the row
  const text = rail.textContent.replace(/\s+/g, ' ')
  expect(text).toMatch(/Celtics ?108 ?– ?88 ?Mavericks/)
})

test('no rail at all when the feed is empty', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
  render(<Landing />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  expect(screen.queryByLabelText('Recent results')).toBeNull()
})

test('no rail when the feed is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  render(<Landing />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
  expect(screen.queryByLabelText('Recent results')).toBeNull()
})

test('a drawn game stays in home order rather than crowning the home side', async () => {
  const draw = {
    id: 'ev2', competition: 'World Cup 2026', sport: 'football', playedAt: '2026-08-02T00:00:00Z',
    home: { name: 'Egypt', score: 1, won: false },
    away: { name: 'South Africa', score: 1, won: false },
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [draw] })))
  render(<Landing />)
  const rail = await screen.findByLabelText('Recent results')
  expect(rail.textContent.replace(/\s+/g, ' ')).toMatch(/Egypt ?1 ?– ?1 ?South Africa/)
  expect(rail.querySelector('b')).toBeNull()   // nobody is bolded as the winner
})

/* The fork shipped with FIFA's World Cup trophy as the mark. It is not ours and
   this is not a World Cup product — nothing may reference it again. */
test('the marketing pages carry our own mark, never the World Cup trophy', () => {
  const { container } = render(<Landing />)
  expect(container.innerHTML).not.toMatch(/trophy/i)
  expect(container.querySelector('svg')).toBeTruthy()
})
