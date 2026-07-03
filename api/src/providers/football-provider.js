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
 * @property {string|null} group
 * @property {null} rank   football has no single provider-ranked position (unlike basketball's conference position)
 * @property {number} pts
 * @property {{played:number, win:number, draw:number, loss:number, gf:number, ga:number}} stats
 *
 * @typedef {Object} DomainTeam { providerTeamId:number, name:string, code:string|null, country:string|null }
 *
 * @typedef {Object} DomainLeague
 * @property {number} providerLeagueId
 * @property {string} name @property {string} type @property {string|null} logo
 * @property {Array<{season:string, start:string, end:string}>} seasons
 *
 * A FootballProvider returns DOMAIN shapes (already mapped from raw JSON).
 * @typedef {Object} FootballProvider
 * @property {'football'} sport
 * @property {true} groupsFromStandings  soccer resolves group letters from /standings, not the round string
 * @property {() => Promise<DomainLeague[]>} fetchCompetitions
 * @property {(comp:{season:number|string}) => Promise<DomainFixture[]>} fetchSchedule
 * @property {(comp:{season:number|string}) => Promise<DomainStanding[]>} fetchStandings
 * @property {(fixtureId:string) => Promise<RawProb|null>} fetchPredictions
 * @property {(fixtureId:string) => Promise<{markets:object, book:string, prob:RawProb|null}|null>} fetchOdds
 * @property {() => Promise<DomainFixture[]>} fetchLive
 * @property {(ids:string[]) => Promise<DomainFixture[]>} fetchResults  any status, batched ≤20
 * @property {(comp:{season:number|string}) => Promise<DomainTeam[]>} fetchCompetitors
 * @property {(fixtureId:string) => Promise<object|null>} fetchLineups  raw /fixtures/lineups json
 * @property {(fixtureId:string) => Promise<object>} fetchEvents  raw /fixtures/events json
 * @property {(fixtureId:string) => Promise<object|null>} fetchStatistics  raw /fixtures/statistics json
 * @property {(teamId:number) => Promise<Array<{name:string,number:number|null,pos:string,photo:string}>|null>} fetchSquad
 * @property {(game:DomainFixture) => ('HOME'|'AWAY'|'DRAW'|null)} resultToWinnerCode
 * @property {(f:DomainFixture) => object} baseDetail
 */
export {} // types-only module
