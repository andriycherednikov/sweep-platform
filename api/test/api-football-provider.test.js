import { expect, test, vi } from 'vitest'
import { createApiFootballProvider } from '../src/providers/api-football-provider.js'

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
  await p.fetchFixtures(2026)
  const calledUrl = new URL(fetch.mock.calls[0][0])
  expect(calledUrl.searchParams.get('league')).toBe('1')
  expect(calledUrl.searchParams.get('season')).toBe('2026')
  expect(fetch.mock.calls[0][1].headers['x-apisports-key']).toBe('K')
})

test('fetchFixtures maps raw response to domain fixtures', async () => {
  const fetch = fakeFetch({ '/fixtures': {
    response: [{ fixture: { id: 1, date: '2026-06-13T03:30:00+00:00', status: { short: 'NS', elapsed: null }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Group A - 1' }, teams: { home: { id: 10 }, away: { id: 11 } }, goals: { home: null, away: null } }] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const [f] = await p.fetchFixtures(2026)
  expect(f).toMatchObject({ id: '1', group: 'A', homeProviderId: 10, awayProviderId: 11, status: 'upcoming' })
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
  expect(r).toEqual({ a: 53, d: 26, b: 21 })
})

test('fetchFixturesByIds queries ?ids=a-b and maps regardless of status', async () => {
  const fetch = fakeFetch({ '/fixtures': { response: [
    { fixture: { id: 1, date: '2026-06-13T03:30:00+00:00', status: { short: 'FT', elapsed: 90 }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Group A - 1' }, teams: { home: { id: 10 }, away: { id: 11 } }, goals: { home: 2, away: 0 } },
    { fixture: { id: 2, date: '2026-06-13T06:00:00+00:00', status: { short: 'NS', elapsed: null }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Group A - 1' }, teams: { home: { id: 12 }, away: { id: 13 } }, goals: { home: null, away: null } },
  ] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  const r = await p.fetchFixturesByIds(['1', '2'])
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get('ids')).toBe('1-2')
  expect(r.map((f) => f.status)).toEqual(['final', 'upcoming']) // returns finished AND not-started
})

test('fetchFixturesByIds returns [] for no ids without calling fetch', async () => {
  const fetch = vi.fn()
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  expect(await p.fetchFixturesByIds([])).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

test('fetchFixturesByIds batches ids in chunks of 20', async () => {
  const fetch = fakeFetch({ '/fixtures': { response: [] } })
  const p = createApiFootballProvider({ apiKey: 'K', fetch })
  await p.fetchFixturesByIds(Array.from({ length: 25 }, (_, i) => String(i + 1)))
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
  await p.fetchStandings(2026)
  expect(n).toBe(2)
})

test('throws after exhausting retries', async () => {
  const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
  const p = createApiFootballProvider({ apiKey: 'K', fetch, retries: 2, retryDelayMs: 0 })
  await expect(p.fetchLive()).rejects.toThrow(/api-football/i)
})
