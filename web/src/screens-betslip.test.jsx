import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BetslipSheet } from './screens-coins.jsx'
import { toggleLeg, clearBetslip } from './betslip.js'
import { setWalletData } from './coins.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'
import * as client from './api/client.js'

beforeEach(() => {
  clearBetslip()
  S.people = [{ id: 'pn_a', name: 'Ann' }]
  S.flag = (c) => `/flags/${c}.png`
  S.team = (c) => ({ code: c, name: c.toUpperCase() })
  S.fixtures = [
    { id: 'f1', t1: 'arg', t2: 'bra', status: 'upcoming', markets: { '1x2': { selections: [{ key: 'HOME', odds: 2 }, { key: 'AWAY', odds: 4 }] } } },
    { id: 'f2', t1: 'fra', t2: 'ger', status: 'upcoming', markets: { '1x2': { selections: [{ key: 'HOME', odds: 1.9 }] } } },
  ]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, parlays: { open: [], settled: [] }, leaderboard: [] })
})

const homeLeg = (fixtureId, odds) => ({ fixtureId, market: '1x2', selection: 'HOME', odds, line: null, book: null, label: 'Home' })

test('BetslipSheet places a 2-leg parlay via placeParlay', async () => {
  vi.spyOn(client, 'postParlay').mockResolvedValueOnce({ parlay: { id: 'par1', stake: 100, combinedOdds: 3.8, potentialPayout: 380, status: 'open', legs: [] }, balance: 900 })
  toggleLeg(homeLeg('f1', 2)); toggleLeg(homeLeg('f2', 1.9))
  render(<BetslipSheet onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '1' }))
  fireEvent.click(screen.getByRole('button', { name: '0' }))
  fireEvent.click(screen.getByRole('button', { name: '0' }))
  fireEvent.click(screen.getByRole('button', { name: /place/i }))
  await waitFor(() => expect(client.postParlay).toHaveBeenCalled())
})

test('BetslipSheet shows a closed-event notice and blocks Place when a leg is closed', () => {
  toggleLeg(homeLeg('f1', 2)); toggleLeg(homeLeg('f2', 1.9))
  S.fixtures[1].status = 'live' // f2 kicked off → its leg is no longer bettable
  render(<BetslipSheet onClose={() => {}} />)
  expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /place/i })).toBeDisabled()
})

test('removing a leg from the sheet drops it', () => {
  toggleLeg(homeLeg('f1', 2)); toggleLeg(homeLeg('f2', 1.9))
  render(<BetslipSheet onClose={() => {}} />)
  let removes = screen.getAllByRole('button', { name: /remove/i })
  expect(removes).toHaveLength(2)
  fireEvent.click(removes[0])
  expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(1)
})
