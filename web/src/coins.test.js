import { expect, test, vi, beforeEach } from 'vitest'
import * as client from './api/client.js'
import { setWalletData, myBalance, placeBet, coinsLeaderboard, balanceByPerson } from './coins.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  S.people = [{ id: 'pn_a', name: 'Ann' }, { id: 'pn_b', name: 'Bob' }]
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', status: 'upcoming', odds: { home: 2, draw: 3.5, away: 4, book: 'Pinnacle' } }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_a', balance: 1000 }, { personId: 'pn_b', balance: 1200 }] })
})

test('myBalance reflects the hydrated wallet', () => {
  expect(myBalance()).toBe(1000)
})

test('coinsLeaderboard ranks people by balance, highest first', () => {
  const board = coinsLeaderboard()
  expect(board.map((e) => e.person.id)).toEqual(['pn_b', 'pn_a'])
  expect(board[0].balance).toBe(1200)
})

test('balanceByPerson maps personId to balance', () => {
  expect(balanceByPerson()).toEqual({ pn_a: 1000, pn_b: 1200 })
})

test('placeBet optimistically debits the balance and rolls back on failure', async () => {
  vi.spyOn(client, 'postBet').mockRejectedValueOnce(new Error('nope'))
  await placeBet('f1', 'HOME', 100)
  expect(myBalance()).toBe(1000) // rolled back
})

test('placeBet keeps the debit on success', async () => {
  vi.spyOn(client, 'postBet').mockResolvedValueOnce({ bet: { id: 'b1', fixtureId: 'f1', selection: 'HOME', stake: 100, odds: 2, potentialPayout: 200, status: 'open' }, balance: 900 })
  await placeBet('f1', 'HOME', 100)
  expect(myBalance()).toBe(900)
})
