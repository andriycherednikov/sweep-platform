import { mapFixture, mapStanding, mapPrediction, mapTeam, mapOdds, mapSquad } from './mapping.js'

/** Build a FootballProvider from already-parsed raw API-Football JSON objects. */
export function createRecordedProvider({ fixtures, live, standings, predictions, teams, odds, lineups, squads } = {}) {
  return {
    async fetchFixtures() { return (fixtures?.response ?? []).map(mapFixture) },
    async fetchLive() { return (live?.response ?? []).map(mapFixture) },
    async fetchFixturesByIds(ids) {
      const want = new Set(ids.map(String))
      return (fixtures?.response ?? []).filter((r) => want.has(String(r.fixture.id))).map(mapFixture)
    },
    async fetchStandings() { return (standings?.response?.[0]?.league?.standings ?? []).flat().map(mapStanding) },
    async fetchPredictions() { return mapPrediction(predictions) },
    async fetchOdds() { return mapOdds(odds) },
    async fetchTeams() { return (teams?.response ?? []).map(mapTeam) },
    async fetchLineups() { return lineups ?? null },
    async fetchSquad() { return mapSquad(squads) },
  }
}
