import { test, expect } from 'vitest'
import { createApiSportsClient, winnerSideToResult } from '../src/providers/api-sports-base.js'

const okJson = (body) => ({ ok: true, json: async () => body })

test('get() hits base+path with params and the api key header', async () => {
  const calls = []
  const client = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k',
    fetch: async (url, opts) => { calls.push({ url, opts }); return okJson({ response: [1] }) },
  })
  const j = await client.get('/games', { league: 12, season: '2023-2024' })
  expect(j).toEqual({ response: [1] })
  expect(calls[0].url).toBe('https://x.test/games?league=12&season=2023-2024')
  expect(calls[0].opts.headers['x-apisports-key']).toBe('k')
})

test('get() retries 500 then succeeds; does not retry 404', async () => {
  let n = 0
  const flaky = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k', retryDelayMs: 1,
    fetch: async () => (++n === 1 ? { ok: false, status: 500 } : okJson({ ok: 1 })),
  })
  expect(await flaky.get('/a')).toEqual({ ok: 1 })
  expect(n).toBe(2)

  let m = 0
  const notFound = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k', retryDelayMs: 1,
    fetch: async () => { m++; return { ok: false, status: 404 } },
  })
  await expect(notFound.get('/a')).rejects.toThrow(/HTTP 404/)
  expect(m).toBe(1)
})

test('winnerSideToResult maps sides and guards no-draw sports', () => {
  expect(winnerSideToResult('home', 'football')).toBe('HOME')
  expect(winnerSideToResult('away', 'basketball')).toBe('AWAY')
  expect(winnerSideToResult('draw', 'football')).toBe('DRAW')
  expect(winnerSideToResult(null, 'football')).toBeNull()
  expect(() => winnerSideToResult('draw', 'basketball')).toThrow(/no-draw/)
})

test('winnerSideToResult throws on a garbage side instead of leaking DRAW past the guard', () => {
  expect(() => winnerSideToResult('banana', 'basketball')).toThrow(/unknown winner side/)
  expect(() => winnerSideToResult('banana', 'football')).toThrow(/unknown winner side/)
})

// API-Sports answers a refused request with HTTP 200 and an `errors` object.
// Before this guard the body sailed through as success: `response` was absent,
// mappers read `j.response ?? []`, and the live poller logged status:'ok'.
test('get() throws on an API-Sports error body served as HTTP 200', async () => {
  const client = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k', retryDelayMs: 1,
    fetch: async () => okJson({
      errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' },
      results: 0, response: [],
    }),
  })
  await expect(client.get('/fixtures')).rejects.toThrow(/plan: Free plans do not have access/)
})

test('get() treats the healthy empty-array errors field as success', async () => {
  const client = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k',
    fetch: async () => okJson({ errors: [], results: 1, response: [{ id: 1 }] }),
  })
  expect(await client.get('/fixtures')).toEqual({ errors: [], results: 1, response: [{ id: 1 }] })
})

test('get() does not spend retries on an error body — no backoff fixes a plan or a quota', async () => {
  let n = 0
  const client = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k', retryDelayMs: 1,
    fetch: async () => { n++; return okJson({ errors: { requests: 'You have reached the request limit for the day' } }) },
  })
  await expect(client.get('/fixtures')).rejects.toThrow(/requests: You have reached/)
  expect(n).toBe(1)
})

test('get() names the path and reports every error key it was given', async () => {
  const client = createApiSportsClient({
    base: 'https://x.test', apiKey: 'k', retryDelayMs: 1,
    fetch: async () => okJson({ errors: { token: 'bad key', rateLimit: 'too many' } }),
  })
  await expect(client.get('/games')).rejects.toThrow(/api-sports \/games → token: bad key; rateLimit: too many/)
})
