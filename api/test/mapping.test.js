import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapStatus, parseRound, mapFixture, mapStanding, mapPrediction, mapTeam } from '../src/providers/mapping.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))

test('mapStatus maps API short codes to our status', () => {
  expect(mapStatus('NS')).toBe('upcoming')
  expect(mapStatus('FT')).toBe('final')
  expect(mapStatus('AET')).toBe('final')
  expect(mapStatus('2H')).toBe('live')
  expect(mapStatus('HT')).toBe('live')
  expect(mapStatus('PST')).toBe('upcoming')
})

test('parseRound: real "Group Stage - N" (no letter), embedded form, and knockout', () => {
  expect(parseRound('Group Stage - 1')).toEqual({ group: '', matchday: 1, stage: 'group' })
  expect(parseRound('Group Stage - 3')).toEqual({ group: '', matchday: 3, stage: 'group' })
  expect(parseRound('Group L - 1')).toEqual({ group: 'L', matchday: 1, stage: 'group' })
  expect(parseRound('Round of 16')).toEqual({ group: '', matchday: 0, stage: 'knockout' })
})

test('mapFixture turns a raw fixture into a DomainFixture (group resolved later from standings)', () => {
  const [fin, ups] = load('fixtures').response.map(mapFixture)
  expect(fin).toMatchObject({
    id: '9001', group: '', matchday: 1, stage: 'group',
    homeProviderId: 3001, awayProviderId: 3002, status: 'final',
    score1: 2, score2: 1, venue: 'Estadio Akron', city: 'Guadalajara',
  })
  expect(fin.kickoffUtc instanceof Date).toBe(true)
  expect(ups).toMatchObject({ id: '9002', status: 'upcoming', score1: null, score2: null, minute: null })
})

test('mapStanding maps a raw row (group label, lose→loss, goals.for/against→gf/ga)', () => {
  const rows = load('standings').response[0].league.standings.flat().map(mapStanding)
  expect(rows[0]).toEqual({ providerTeamId: 3001, group: 'L', played: 1, win: 1, draw: 0, loss: 0, gf: 2, ga: 1, pts: 3 })
  // the "Ranking of third-placed teams" pseudo-group has no group letter
  expect(rows.at(-1).group).toBeNull()
})

test('mapPrediction turns percent strings into integers, or null', () => {
  expect(mapPrediction(load('predictions'))).toEqual({ a: 55, d: 25, b: 20 })
  expect(mapPrediction({ response: [] })).toBeNull()
  expect(mapPrediction(null)).toBeNull()
})

test('mapTeam extracts provider id, name, code, country', () => {
  expect(load('teams').response.map(mapTeam)[0]).toEqual({ providerTeamId: 3001, name: 'Croatia', code: 'CRO', country: 'Croatia' })
})
