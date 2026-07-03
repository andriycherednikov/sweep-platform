import { expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createApiFootballProvider } from '../src/providers/api-football-provider.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))
const COMP = { id: 'apifootball:1:2026', provider: 'apifootball', sport: 'football', leagueId: '1', season: '2026' }

function fakeFetch(routes) {
  return vi.fn(async (url) => {
    const u = new URL(url)
    const key = u.pathname + (u.search || '')
    const match = Object.keys(routes).find((r) => key.startsWith(r))
    if (!match) return { ok: false, status: 404, json: async () => ({ response: [] }) }
    const r = routes[match]
    return { ok: true, status: 200, json: async () => r }
  })
}

test('sends the api key header and league/season params', async () => {
  const fetch = fakeFetch({ '/fixtures': { response: [] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  await p.fetchSchedule(COMP)
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.searchParams.get('league')).toBe('1')
  expect(calledUrl.searchParams.get('season')).toBe('2026')
  expect(fetch.mock.calls[0][1].headers['x-apisports-key']).toBe('K')
})

test('fetchSchedule maps raw response to domain fixtures', async () => {
  const fetch = fakeFetch({ '/fixtures': {
    response: [{ fixture: { id: 1, date: '2026-06-13T03:30:00+00:00', status: { short: 'NS', elapsed: null }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Group A - 1' }, teams: { home: { id: 10 }, away: { id: 11 } }, goals: { home: null, away: null } }] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const [f] = await p.fetchSchedule(COMP)
  expect(f).toMatchObject({ id: '1', group: 'A', homeProviderId: 10, awayProviderId: 11, status: 'upcoming' })
})

test('sport/groupsFromStandings/resultToWinnerCode/baseDetail', async () => {
  const p = createApiFootballProvider({ apiKey: 'K', fetch: fakeFetch({}) })
  expect(p.sport).toBe('football')
  expect(p.groupsFromStandings).toBe(true)
  expect(p.resultToWinnerCode({ winnerSide: 'home' })).toBe('HOME')
  expect(p.resultToWinnerCode({ winnerSide: 'draw' })).toBe('DRAW')
  const f = { group: 'A', matchday: 1, venue: 'V', city: 'C', minute: null, phase: null, htScore1: 1, htScore2: 0, regScore1: null, regScore2: null, penScore1: null, penScore2: null }
  expect(p.baseDetail(f)).toEqual({ group: 'A', matchday: 1, venue: 'V', city: 'C', minute: null, phase: null, ht: [1, 0], reg: null, pen: null })
})

test('fetchCompetitions queries /leagues?id=1 and maps to the catalog shape', async () => {
  const fetch = fakeFetch({ '/leagues': load('leagues') })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const [l] = await p.fetchCompetitions()
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.pathname).toBe('/leagues')
  expect(calledUrl.searchParams.get('id')).toBe('1')
  expect(l).toMatchObject({ providerLeagueId: 1, name: 'World Cup', type: 'Cup' })
  expect(l.seasons.map((s) => s.season)).toContain('2026')
})

test('fetchCompetitors sends league/season params and maps teams', async () => {
  const fetch = fakeFetch({ '/teams': { response: [{ team: { id: 3001, name: 'Croatia', code: 'CRO', country: 'Croatia' } }] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const [t] = await p.fetchCompetitors(COMP)
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.searchParams.get('league')).toBe('1')
  expect(calledUrl.searchParams.get('season')).toBe('2026')
  expect(t).toEqual({ providerTeamId: 3001, name: 'Croatia', code: 'CRO', country: 'Croatia' })
})

test('fetchOdds maps a Match Winner market to implied probs', async () => {
  const fetch = fakeFetch({ '/odds': { response: [{ bookmakers: [{ name: 'B', bets: [
    { name: 'Match Winner', values: [
      { value: 'Home', odd: '1.80' }, { value: 'Draw', odd: '3.60' }, { value: 'Away', odd: '4.50' },
    ] },
  ] }] }] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const r = await p.fetchOdds('9002')
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.pathname).toBe('/odds')
  expect(calledUrl.searchParams.get('fixture')).toBe('9002')
  // must NOT send league — /odds rejects league without season, silently yielding 0 results
  expect(calledUrl.searchParams.get('league')).toBeNull()
  expect(r.book).toBe('B')
  expect(r.markets['1x2'].selections.map(s => s.key)).toEqual(['HOME', 'DRAW', 'AWAY'])
  expect(r.prob.a + r.prob.d + r.prob.b).toBe(100)
})

test('fetchResults queries ?ids=a-b and maps regardless of status', async () => {
  const fetch = fakeFetch({ '/fixtures': { response: [
    { fixture: { id: 1, date: '2026-06-13T03:30:00+00:00', status: { short: 'FT', elapsed: 90 }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Group A - 1' }, teams: { home: { id: 10 }, away: { id: 11 } }, goals: { home: 2, away: 0 } },
    { fixture: { id: 2, date: '2026-06-13T06:00:00+00:00', status: { short: 'NS', elapsed: null }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Group A - 1' }, teams: { home: { id: 12 }, away: { id: 13 } }, goals: { home: null, away: null } },
  ] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const r = await p.fetchResults(['1', '2'])
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get('ids')).toBe('1-2')
  expect(r.map((f) => f.status)).toEqual(['final', 'upcoming']) // returns finished AND not-started
})

test('fetchResults returns [] for no ids without calling fetch', async () => {
  const fetch = vi.fn()
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  expect(await p.fetchResults([])).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

test('fetchResults batches ids in chunks of 20', async () => {
  const fetch = fakeFetch({ '/fixtures': { response: [] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  await p.fetchResults(Array.from({ length: 25 }, (_, i) => String(i + 1)))
  expect(fetch.mock.calls.length).toBe(2) // 20 + 5
})

test('fetchLineups returns raw json and queries by fixture', async () => {
  const raw = { response: [{ team: { id: 3001 }, formation: '4-3-3', startXI: [] }] }
  const fetch = fakeFetch({ '/fixtures/lineups': raw })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const r = await p.fetchLineups('9002')
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.pathname).toBe('/fixtures/lineups')
  expect(calledUrl.searchParams.get('fixture')).toBe('9002')
  expect(r).toEqual(raw)
})

test('fetchEvents queries /fixtures/events?fixture= and returns raw json', async () => {
  const raw = { response: [{ time: { elapsed: 23 }, team: { id: 3001 }, player: { name: 'Modric' }, type: 'Goal', detail: 'Normal Goal' }] }
  const fetch = fakeFetch({ '/fixtures/events': raw })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const out = await p.fetchEvents('9002')
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.pathname).toBe('/fixtures/events')
  expect(calledUrl.searchParams.get('fixture')).toBe('9002')
  expect(out).toEqual(raw) // raw passthrough — crosswalk mapping is the poller's job
})

test('fetchSquad maps a team squad and queries by team', async () => {
  const fetch = fakeFetch({ '/players/squads': { response: [{ team: { id: 3001 }, players: [
    { name: 'L. Modric', number: 10, position: 'Midfielder', photo: 'p.png' },
  ] }] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const r = await p.fetchSquad(3001)
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.pathname).toBe('/players/squads')
  expect(calledUrl.searchParams.get('team')).toBe('3001')
  expect(r).toEqual([{ name: 'L. Modric', number: 10, pos: 'Midfielder', photo: 'p.png' }])
})

test('retries on a 500 then succeeds', async () => {
  let n = 0
  const fetch = vi.fn(async () => (++n < 2
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ response: [] }) }))
  const p = createApiFootballProvider({ apiKey: 'K', fetch, retries: 3, retryDelayMs: 0 })
  await p.fetchStandings(COMP)
  expect(n).toBe(2)
})

test('throws after exhausting retries', async () => {
  const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
  const p = createApiFootballProvider({ apiKey: 'K', fetch, retries: 2, retryDelayMs: 0 })
  await expect(p.fetchLive()).rejects.toThrow(/api-sports/i)
})
