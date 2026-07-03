import { winnerSideToResult } from './api-sports-base.js'
import { mapGame, mapBasketTeam, mapBasketStanding, mapLeague } from './basketball-mapping.js'

/** Build a basketball adapter from already-parsed raw API-Basketball JSON objects (tests + CLI dry runs). */
export function createRecordedBasketballProvider({ leagues, teams, games, standings } = {}) {
  return {
    sport: 'basketball',
    dropUnknownTeams: true,
    async fetchCompetitions() { return (leagues?.response ?? []).map(mapLeague) },
    async fetchCompetitors() { return (teams?.response ?? []).map(mapBasketTeam).filter(Boolean) },
    async fetchSchedule() { return (games?.response ?? []).map(mapGame) },
    async fetchResults(ids) {
      const want = new Set(ids.map(String))
      return (games?.response ?? []).filter((g) => want.has(String(g.id))).map(mapGame)
    },
    async fetchStandings() { return (standings?.response?.[0] ?? []).map(mapBasketStanding).filter(Boolean) },
    resultToWinnerCode(game) { return winnerSideToResult(game.winnerSide, 'basketball') },
    baseDetail(game) { return game.detail },
  }
}
