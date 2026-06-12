import { mapFixture, mapStanding, mapPrediction, mapTeam, mapOdds, mapSquad } from './mapping.js'

const BASE = 'https://v3.football.api-sports.io'
const LEAGUE = 1

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {{apiKey:string, fetch?:typeof fetch, retries?:number, retryDelayMs?:number, base?:string}} opts
 * @returns {import('./football-provider.js').FootballProvider}
 */
export function createApiFootballProvider({ apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500, base = BASE }) {
  async function get(path, params = {}) {
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    let lastErr
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url.toString(), { headers: { 'x-apisports-key': apiKey } })
        if (res.ok) return await res.json()
        lastErr = new Error(`api-football ${path} → HTTP ${res.status}`)
        if (res.status < 500 && res.status !== 429) break // client errors don't retry (except rate-limit)
      } catch (e) { lastErr = e }
      if (attempt < retries - 1) await sleep(retryDelayMs * 2 ** attempt)
    }
    throw lastErr ?? new Error(`api-football ${path} failed`)
  }

  return {
    async fetchFixtures(season) {
      const j = await get('/fixtures', { league: LEAGUE, season })
      return (j.response ?? []).map(mapFixture)
    },
    async fetchLive() {
      const j = await get('/fixtures', { live: 'all' })
      return (j.response ?? []).filter((r) => r.league?.id === LEAGUE).map(mapFixture)
    },
    async fetchFixturesByIds(ids) {
      // Poll specific fixtures regardless of status — unlike live=all, this still
      // returns a match once it's finished, so we catch the live→final transition.
      // /fixtures?ids= is capped at 20 ids per call, so batch.
      const out = []
      for (let i = 0; i < ids.length; i += 20) {
        const j = await get('/fixtures', { ids: ids.slice(i, i + 20).join('-') })
        out.push(...(j.response ?? []).map(mapFixture))
      }
      return out
    },
    async fetchStandings(season) {
      const j = await get('/standings', { league: LEAGUE, season })
      return (j.response?.[0]?.league?.standings ?? []).flat().map(mapStanding)
    },
    async fetchPredictions(fixtureId) {
      const j = await get('/predictions', { fixture: fixtureId })
      return mapPrediction(j)
    },
    async fetchOdds(fixtureId) {
      // by fixture only — /odds rejects `league` unless `season` is also given,
      // which would silently yield 0 results and fall back to /predictions placeholders
      const j = await get('/odds', { fixture: fixtureId })
      return mapOdds(j)
    },
    async fetchTeams(season) {
      const j = await get('/teams', { league: LEAGUE, season })
      return (j.response ?? []).map(mapTeam)
    },
    async fetchLineups(fixtureId) {
      // raw json — crosswalk resolution is a DB concern, done by the poller
      return get('/fixtures/lineups', { fixture: fixtureId })
    },
    async fetchSquad(teamId) {
      const j = await get('/players/squads', { team: teamId })
      return mapSquad(j)
    },
  }
}
