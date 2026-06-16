import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapStatus, parseRound, mapFixture, mapStanding, mapPrediction, mapTeam, mapOdds, mapLineups, mapSquad, mapEvents } from '../src/providers/mapping.js'

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

test('mapOdds: first complete Match Winner market → implied probs summing to 100 (decoy bets ignored)', () => {
  const r = mapOdds(load('odds'))
  // 1/1.80, 1/3.60, 1/4.50 normalized, largest-remainder rounded
  expect(r).toMatchObject({ a: 53, d: 26, b: 21 })
  expect(r.a + r.d + r.b).toBe(100)
})

test('mapOdds: null on no bookmaker, no Match Winner market, or missing/degenerate odds', () => {
  expect(mapOdds({ response: [] })).toBeNull()
  expect(mapOdds(null)).toBeNull()
  // bookmaker without a Match Winner bet
  expect(mapOdds({ response: [{ bookmakers: [{ bets: [{ name: 'Goals Over/Under', values: [] }] }] }] })).toBeNull()
  // a missing odd value
  expect(mapOdds({ response: [{ bookmakers: [{ bets: [{ name: 'Match Winner', values: [
    { value: 'Home', odd: '2.00' }, { value: 'Draw', odd: '3.00' },
  ] }] }] }] })).toBeNull()
  // an odd <= 1 (impossible/garbage)
  expect(mapOdds({ response: [{ bookmakers: [{ bets: [{ name: 'Match Winner', values: [
    { value: 'Home', odd: '1.00' }, { value: 'Draw', odd: '3.00' }, { value: 'Away', odd: '4.00' },
  ] }] }] }] })).toBeNull()
})

test('mapLineups: resolves provider team ids → codes, keeps formation + 11 starters', () => {
  const cw = new Map([[3001, 'hr'], [3002, 'be']])
  const r = mapLineups(load('lineups'), cw)
  expect(r).toHaveLength(2)
  expect(r[0]).toMatchObject({ teamCode: 'hr', formation: '4-3-3' })
  expect(r[0].startXI).toHaveLength(11)
  expect(r[0].startXI[6]).toEqual({ name: 'L. Modric', number: 10, pos: 'M' })
  // a player missing a number is tolerated (Belgium's Carrasco)
  const carrasco = r[1].startXI.find((p) => p.name === 'Y. Carrasco')
  expect(carrasco).toEqual({ name: 'Y. Carrasco', number: null, pos: 'M' })
})

test('mapLineups: drops teams not in the crosswalk; keeps a one-team array', () => {
  const r = mapLineups(load('lineups'), new Map([[3001, 'hr']]))
  expect(r).toHaveLength(1)
  expect(r[0].teamCode).toBe('hr')
})

test('mapLineups: null when empty, missing, or all teams unresolved', () => {
  expect(mapLineups(load('lineups'), new Map())).toBeNull()
  expect(mapLineups({ response: [] }, new Map([[3001, 'hr']]))).toBeNull()
  expect(mapLineups(null, new Map([[3001, 'hr']]))).toBeNull()
})

test('mapSquad: players → {name,number,pos,photo}; missing number tolerated', () => {
  const r = mapSquad(load('squads'))
  expect(r).toHaveLength(5)
  expect(r[0]).toEqual({ name: 'D. Livakovic', number: 1, pos: 'Goalkeeper', photo: 'https://media.api-sports.io/football/players/1.png' })
  const moro = r.find((p) => p.name === 'N. Moro')
  expect(moro.number).toBeNull() // missing number is tolerated, not dropped
})

test('mapSquad: null when empty or missing', () => {
  expect(mapSquad({ response: [] })).toBeNull()
  expect(mapSquad(null)).toBeNull()
})

test('mapTeam extracts provider id, name, code, country', () => {
  expect(load('teams').response.map(mapTeam)[0]).toEqual({ providerTeamId: 3001, name: 'Croatia', code: 'CRO', country: 'Croatia' })
})

const XW = new Map([[3001, 'hr'], [3002, 'be']])
const rawEvents = (list) => ({ response: list })

test('mapEvents keeps only Goal and Card, dropping subst/Var', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 23, extra: null }, team: { id: 3001 }, player: { name: 'Modric' }, assist: { name: 'Perisic' }, type: 'Goal', detail: 'Normal Goal' },
    { time: { elapsed: 60, extra: null }, team: { id: 3002 }, player: { name: 'Lukaku' }, assist: { name: null }, type: 'subst', detail: 'Substitution 1' },
    { time: { elapsed: 70, extra: null }, team: { id: 3001 }, player: { name: 'VAR' }, type: 'Var', detail: 'Goal cancelled' },
  ]), XW)
  expect(out).toHaveLength(1)
  expect(out[0]).toMatchObject({ type: 'goal', teamCode: 'hr', player: 'Modric', minute: 23, detail: 'Normal Goal', assist: 'Perisic' })
})

test('mapEvents derives card colour from detail (yellow / red / second yellow)', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 30, extra: null }, team: { id: 3001 }, player: { name: 'A' }, type: 'Card', detail: 'Yellow Card' },
    { time: { elapsed: 55, extra: null }, team: { id: 3002 }, player: { name: 'B' }, type: 'Card', detail: 'Red Card' },
    { time: { elapsed: 80, extra: null }, team: { id: 3002 }, player: { name: 'C' }, type: 'Card', detail: 'Second Yellow card' },
  ]), XW)
  expect(out.map((e) => e.card)).toEqual(['yellow', 'red', 'red'])
  expect(out[0]).not.toHaveProperty('assist') // cards carry no assist
})

test('mapEvents labels penalty and own-goal via detail, null-safe assist', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 12, extra: null }, team: { id: 3001 }, player: { name: 'P' }, assist: { name: null }, type: 'Goal', detail: 'Penalty' },
    { time: { elapsed: 41, extra: null }, team: { id: 3002 }, player: { name: 'O' }, type: 'Goal', detail: 'Own Goal' },
  ]), XW)
  expect(out[0]).toMatchObject({ type: 'goal', detail: 'Penalty', assist: null })
  expect(out[1]).toMatchObject({ type: 'goal', detail: 'Own Goal', assist: null })
})

test('mapEvents drops events whose team is not in the crosswalk', () => {
  const out = mapEvents(rawEvents([
    { time: { elapsed: 5, extra: null }, team: { id: 9999 }, player: { name: 'X' }, type: 'Goal', detail: 'Normal Goal' },
  ]), XW)
  expect(out).toEqual([])
})

test('mapEvents produces a stable id from elapsed/extra/team/player/type/detail', () => {
  const raw = rawEvents([{ time: { elapsed: 45, extra: 2 }, team: { id: 3001 }, player: { name: 'Modric' }, type: 'Goal', detail: 'Normal Goal' }])
  const a = mapEvents(raw, XW)[0].id
  const b = mapEvents(raw, XW)[0].id
  expect(a).toBe(b)
  expect(a).toBe('45|2|hr|Modric|goal|Normal Goal')
})

const oddsResponse = (bookmakers) => ({ response: [{ bookmakers }] })
const mw = (home, draw, away) => ({ name: 'Match Winner', values: [
  { value: 'Home', odd: String(home) }, { value: 'Draw', odd: String(draw) }, { value: 'Away', odd: String(away) },
] })

test('mapOdds prefers Pinnacle even when another book appears first', () => {
  const r = mapOdds(oddsResponse([
    { id: 8, name: 'Bet365', bets: [mw(2.0, 3.4, 4.0)] },
    { id: 4, name: 'Pinnacle', bets: [mw(2.1, 3.3, 3.8)] },
  ]))
  expect(r.book).toBe('Pinnacle')
  expect(r.odds).toEqual({ home: 2.1, draw: 3.3, away: 3.8 })
  expect(r.a + r.d + r.b).toBe(100)
})

test('mapOdds falls back to Bet365, then to the first complete 1X2 book', () => {
  const noPin = mapOdds(oddsResponse([
    { id: 99, name: 'SomeBook', bets: [mw(1.9, 3.5, 4.2)] },
    { id: 8, name: 'Bet365', bets: [mw(2.0, 3.4, 4.0)] },
  ]))
  expect(noPin.book).toBe('Bet365')
  const neither = mapOdds(oddsResponse([{ id: 99, name: 'SomeBook', bets: [mw(1.9, 3.5, 4.2)] }]))
  expect(neither.book).toBe('SomeBook')
  expect(neither.odds.home).toBe(1.9)
})

test('mapOdds skips books with an incomplete Match Winner market and returns null when none usable', () => {
  expect(mapOdds(oddsResponse([{ id: 4, name: 'Pinnacle', bets: [{ name: 'Match Winner', values: [{ value: 'Home', odd: '2.0' }] }] }]))).toBeNull()
  expect(mapOdds(oddsResponse([]))).toBeNull()
})

const rawFix = (over = {}) => ({
  fixture: { id: 42, date: '2026-06-20T18:00:00Z', status: { short: over.short ?? 'NS', elapsed: null }, venue: {} },
  league: { round: 'Group Stage - 1' },
  teams: { home: { id: 1, winner: over.homeWin ?? null }, away: { id: 2, winner: over.awayWin ?? null } },
  goals: { home: over.gh ?? null, away: over.ga ?? null },
})

test('mapFixture maps the home/away winner booleans to a winnerSide', () => {
  expect(mapFixture(rawFix({ short: 'FT', homeWin: true, awayWin: false, gh: 2, ga: 1 })).winnerSide).toBe('home')
  expect(mapFixture(rawFix({ short: 'PEN', homeWin: false, awayWin: true, gh: 1, ga: 1 })).winnerSide).toBe('away')
})

test('mapFixture reports a draw when neither side won a final, null otherwise', () => {
  expect(mapFixture(rawFix({ short: 'FT', homeWin: false, awayWin: false, gh: 1, ga: 1 })).winnerSide).toBe('draw')
  expect(mapFixture(rawFix({ short: 'NS' })).winnerSide).toBeNull()
})
