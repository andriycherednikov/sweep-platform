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
