import { createApiSportsClient, winnerSideToResult } from './api-sports-base.js'
import { mapGame, mapBasketTeam, mapBasketStanding, mapLeague } from './basketball-mapping.js'

const BASE = 'https://v1.basketball.api-sports.io'

/** API-Basketball adapter. Baseline-sync-only: no fetchLive/odds/lineups capabilities —
 *  their absence gates NBA out of the live tick (owner decision; free tier has no live NBA). */
export function createApiBasketballProvider({ apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500, base = BASE }) {
  const { get } = createApiSportsClient({ base, apiKey, fetch, retries, retryDelayMs })
  return {
    sport: 'basketball',
    dropUnknownTeams: true, // feed-born roster: unknown teams in the schedule (All-Star) drop loudly
    async fetchCompetitions() {
      const j = await get('/leagues')
      return (j.response ?? []).map(mapLeague)
    },
    async fetchCompetitors(comp) {
      const j = await get('/teams', { league: comp.leagueId, season: comp.season })
      return (j.response ?? []).map(mapBasketTeam).filter(Boolean)
    },
    async fetchSchedule(comp) {
      const j = await get('/games', { league: comp.leagueId, season: comp.season })
      return (j.response ?? []).map(mapGame)
    },
    async fetchResults(ids) {
      // ponytail: single id= per call — free tier has no ids= batching; switch when a paid key lands
      const out = []
      for (const id of ids) {
        const j = await get('/games', { id })
        out.push(...(j.response ?? []).map(mapGame))
      }
      return out
    },
    async fetchStandings(comp) {
      const j = await get('/standings', { league: comp.leagueId, season: comp.season })
      return (j.response?.[0] ?? []).map(mapBasketStanding).filter(Boolean)
    },
    resultToWinnerCode(game) { return winnerSideToResult(game.winnerSide, 'basketball') },
    baseDetail(game) { return game.detail },
  }
}
