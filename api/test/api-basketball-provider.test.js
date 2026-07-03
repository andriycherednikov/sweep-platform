import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createApiBasketballProvider } from '../src/providers/api-basketball-provider.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const COMP = { id: 'apibasketball:12:2023-2024', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024' }

test('live adapter calls the right endpoints with league+season and maps responses', async () => {
  const calls = []
  const provider = createApiBasketballProvider({
    apiKey: 'k',
    fetch: async (url) => {
      calls.push(url)
      const path = new URL(url).pathname
      const body = path === '/teams' ? load('teams') : path === '/games' ? load('games')
        : path === '/standings' ? load('standings') : load('leagues')
      return { ok: true, json: async () => body }
    },
  })
  const teams = await provider.fetchCompetitors(COMP)
  expect(teams).toHaveLength(30)
  expect(calls[0]).toBe('https://v1.basketball.api-sports.io/teams?league=12&season=2023-2024')
  const games = await provider.fetchSchedule(COMP)
  expect(games).toHaveLength(6)
  const standings = await provider.fetchStandings(COMP)
  expect(standings).toHaveLength(30)
  expect(provider.sport).toBe('basketball')
  expect(provider.fetchLive).toBeUndefined() // capability gate: no live polling
})

test('fetchResults loops single id= requests (no ids= on free tier)', async () => {
  const calls = []
  const provider = createApiBasketballProvider({
    apiKey: 'k',
    fetch: async (url) => {
      calls.push(url)
      const id = Number(new URL(url).searchParams.get('id'))
      const one = { ...load('games'), response: load('games').response.filter((g) => g.id === id) }
      return { ok: true, json: async () => one }
    },
  })
  const out = await provider.fetchResults(['372186', '372190'])
  expect(out.map((g) => g.id)).toEqual(['372186', '372190'])
  expect(calls).toEqual([
    'https://v1.basketball.api-sports.io/games?id=372186',
    'https://v1.basketball.api-sports.io/games?id=372190',
  ])
})

test('recorded provider serves the same interface from parsed JSON', async () => {
  const provider = createRecordedBasketballProvider({
    leagues: load('leagues'), teams: load('teams'), games: load('games'), standings: load('standings'),
  })
  expect((await provider.fetchCompetitions())[0].providerLeagueId).toBe(12)
  expect(await provider.fetchCompetitors(COMP)).toHaveLength(30)
  const games = await provider.fetchSchedule(COMP)
  expect(games).toHaveLength(6)
  expect(provider.resultToWinnerCode(games.find((g) => g.id === '372186'))).toBe('HOME')
  expect((await provider.fetchResults(['372190']))[0].id).toBe('372190')
  expect(provider.baseDetail(games[0])).toHaveProperty('quarters')
})
