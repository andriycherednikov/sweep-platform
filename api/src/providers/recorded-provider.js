import { mapFixture, mapStanding, mapPrediction, mapTeam } from './mapping.js'

/** Build a FootballProvider from already-parsed raw API-Football JSON objects. */
export function createRecordedProvider({ fixtures, live, standings, predictions, teams } = {}) {
  return {
    async fetchFixtures() { return (fixtures?.response ?? []).map(mapFixture) },
    async fetchLive() { return (live?.response ?? []).map(mapFixture) },
    async fetchStandings() { return (standings?.response?.[0]?.league?.standings ?? []).flat().map(mapStanding) },
    async fetchPredictions() { return mapPrediction(predictions) },
    async fetchTeams() { return (teams?.response ?? []).map(mapTeam) },
  }
}
