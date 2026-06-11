/**
 * @typedef {Object} RawProb { a:number, d:number, b:number } as integer percents
 * @typedef {Object} DomainFixture
 * @property {string} id              provider fixture id, stringified
 * @property {string} group           e.g. 'L'  (parsed from league.round)
 * @property {number} matchday        e.g. 1
 * @property {string} stage           'group' | 'knockout'
 * @property {number} homeProviderId  provider team id (home)
 * @property {number} awayProviderId  provider team id (away)
 * @property {Date}   kickoffUtc
 * @property {string} venue
 * @property {string} city
 * @property {'upcoming'|'live'|'final'} status
 * @property {number|null} score1
 * @property {number|null} score2
 * @property {number|null} minute
 *
 * @typedef {Object} DomainStanding
 * @property {number} providerTeamId
 * @property {number} played @property {number} win @property {number} draw
 * @property {number} loss @property {number} gf @property {number} ga @property {number} pts
 *
 * @typedef {Object} DomainTeam { providerTeamId:number, name:string, code:string|null, country:string|null }
 *
 * A FootballProvider returns DOMAIN shapes (already mapped from raw JSON).
 * @typedef {Object} FootballProvider
 * @property {(season:number) => Promise<DomainFixture[]>} fetchFixtures
 * @property {(season:number) => Promise<DomainStanding[]>} fetchStandings
 * @property {(fixtureId:string) => Promise<RawProb|null>} fetchPredictions
 * @property {(fixtureId:string) => Promise<RawProb|null>} fetchOdds
 * @property {() => Promise<DomainFixture[]>} fetchLive
 * @property {(ids:string[]) => Promise<DomainFixture[]>} fetchFixturesByIds  any status, batched ≤20
 * @property {(season:number) => Promise<DomainTeam[]>} fetchTeams
 * @property {(fixtureId:string) => Promise<object|null>} fetchLineups  raw /fixtures/lineups json
 * @property {(teamId:number) => Promise<Array<{name:string,number:number|null,pos:string,photo:string}>|null>} fetchSquad
 */
export {} // types-only module
