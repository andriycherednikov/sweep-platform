import { mapFixture, mapStanding, mapPrediction, mapTeam, mapMarkets, mapSquad, mapLeague } from './mapping.js'
import { winnerSideToResult } from './api-sports-base.js'

/** Build a FootballProvider from already-parsed raw API-Football JSON objects. */
export function createRecordedProvider({ leagues, fixtures, live, standings, predictions, teams, odds, lineups, events, squads } = {}) {
  return {
    sport: 'football',
    groupsFromStandings: true,
    async fetchCompetitions() { return (leagues?.response ?? []).map(mapLeague) },
    async fetchSchedule() { return (fixtures?.response ?? []).map(mapFixture) },
    async fetchLive() { return (live?.response ?? []).map(mapFixture) },
    async fetchResults(ids) {
      const want = new Set(ids.map(String))
      return (fixtures?.response ?? []).filter((r) => want.has(String(r.fixture.id))).map(mapFixture)
    },
    async fetchStandings() { return (standings?.response?.[0]?.league?.standings ?? []).flat().map(mapStanding) },
    async fetchPredictions() { return mapPrediction(predictions) },
    async fetchOdds() { return mapMarkets(odds) },
    async fetchCompetitors() { return (teams?.response ?? []).map(mapTeam) },
    async fetchLineups() { return lineups ?? null },
    async fetchEvents() { return events ?? { response: [] } },
    async fetchSquad() { return mapSquad(squads) },
    resultToWinnerCode(game) { return winnerSideToResult(game.winnerSide, 'football') },
    baseDetail(f) {
      return {
        group: f.group, matchday: f.matchday, venue: f.venue, city: f.city,
        minute: f.minute ?? null, phase: f.phase ?? null,
        ht: f.htScore1 == null ? null : [f.htScore1, f.htScore2],
        reg: f.regScore1 == null ? null : [f.regScore1, f.regScore2],
        pen: f.penScore1 == null ? null : [f.penScore1, f.penScore2],
      }
    },
  }
}
