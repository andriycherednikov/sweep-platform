import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapStatus, parseRound, mapFixture, mapStanding, mapPrediction, mapTeam, mapLineups, mapSquad, mapEvents, mapMarkets } from '../src/providers/mapping.js'

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

// mapMarkets tests
const oddsResp = (bookmakers) => ({ response: [{ bookmakers }] })
const ov = (value, odd) => ({ value, odd: String(odd) })
const pinnacleBook = {
  name: 'Pinnacle', bets: [
    { name: 'Match Winner', values: [ov('Home', 2.0), ov('Draw', 3.5), ov('Away', 4.0)] },
    { name: 'First Half Winner', values: [ov('Home', 2.6), ov('Draw', 2.1), ov('Away', 5.5)] },
    { name: 'Goals Over/Under', values: [ov('Over 1.5', 1.4), ov('Under 1.5', 3.0), ov('Over 2.5', 2.25), ov('Under 2.5', 1.7), ov('Over 3.5', 4.0), ov('Under 3.5', 1.25)] },
    { name: 'Cards Over/Under', values: [ov('Over 2.5', 1.3), ov('Under 2.5', 3.4), ov('Over 3.5', 1.6), ov('Under 3.5', 2.3)] },
    { name: 'Exact Score', values: [ov('1:0', 5.0), ov('2:1', 8.5), ov('1:1', 8.5), ov('bad', 1.0)] },
    { name: 'Both Teams Score', values: [ov('Yes', 1.8), ov('No', 1.95)] },
    { name: 'Double Chance', values: [ov('Home/Draw', 1.3), ov('Home/Away', 1.25), ov('Draw/Away', 2.1)] },
    { name: 'Odd/Even', values: [ov('Odd', 1.9), ov('Even', 1.9)] },
    { name: 'Goals Over/Under First Half', values: [ov('Over 0.5', 1.5), ov('Under 0.5', 2.4), ov('Over 1.5', 3.2), ov('Under 1.5', 1.3)] },
  ],
}

test('mapMarkets builds all markets from the best-ranked book', () => {
  const r = mapMarkets(oddsResp([{ name: 'SomeBook', bets: [] }, pinnacleBook]))
  expect(r.book).toBe('Pinnacle')
  expect(Object.keys(r.markets).sort()).toEqual(['1x2', 'btts', 'cards', 'cs', 'dc', 'fh1x2', 'fhou', 'oe', 'ou25'])
  expect(r.markets['1x2'].selections.map(s => s.key)).toEqual(['HOME', 'DRAW', 'AWAY'])
  expect(r.markets['ou25']).toMatchObject({ line: 2.5 })
  expect(r.markets['ou25'].selections.find(s => s.key === 'OVER').odds).toBe(2.25)
  expect(r.markets['cards'].line).toBe(3.5)
  expect(r.markets['cs'].selections.map(s => s.key)).toEqual(['1:0', '2:1', '1:1'])
  expect(r.markets['btts'].selections.map(s => s.key)).toEqual(['YES', 'NO'])
  expect(r.markets['dc'].selections.map(s => s.key)).toEqual(['1X', '12', 'X2'])
  expect(r.markets['dc'].selections.find(s => s.key === '1X').odds).toBe(1.3)
  expect(r.markets['oe'].selections.map(s => s.key)).toEqual(['ODD', 'EVEN'])
  expect(r.markets['fhou']).toMatchObject({ line: 0.5 })
  expect(r.markets['fhou'].selections.find(s => s.key === 'OVER').odds).toBe(1.5)
  expect(r.prob.a + r.prob.d + r.prob.b).toBe(100)
})

test('mapMarkets returns null when no usable book/markets', () => {
  expect(mapMarkets(oddsResp([]))).toBeNull()
  expect(mapMarkets(oddsResp([{ name: 'X', bets: [{ name: 'Match Winner', values: [ov('Home', 2)] }] }]))).toBeNull()
})

test('mapMarkets reads anytime goalscorer from Bet365 even when main lines come from Pinnacle', () => {
  const bet365 = { name: 'Bet365', bets: [
    { name: 'Match Winner', values: [ov('Home', 2.1), ov('Draw', 3.4), ov('Away', 3.9)] },
    { name: 'Anytime Goal Scorer', values: [ov('Lionel Messi', 2.5), ov('Julian Alvarez', 3.0), ov('No Goalscorer', 1.0)] },
  ] }
  const r = mapMarkets(oddsResp([pinnacleBook, bet365]))
  expect(r.book).toBe('Pinnacle')                 // main lines still from the best-ranked book
  expect(r.markets['1x2'].book).toBe('Pinnacle')
  expect(r.markets['gs'].book).toBe('Bet365')     // player props pulled from Bet365
  expect(r.markets['gs'].selections.map(s => s.key)).toEqual(['Lionel Messi', 'Julian Alvarez']) // odds<=1 dropped
})

test('mapMarkets has no goalscorer market when no book carries it', () => {
  const r = mapMarkets(oddsResp([pinnacleBook]))
  expect(r.markets['gs']).toBeUndefined()
})

test('mapFixture captures the half-time score', () => {
  const raw = { fixture: { id: 7, date: '2026-06-20T18:00:00Z', status: { short: 'FT', elapsed: 90 }, venue: {} },
    league: { round: 'Group Stage - 1' }, teams: { home: { id: 1, winner: true }, away: { id: 2, winner: false } },
    goals: { home: 2, away: 1 }, score: { halftime: { home: 1, away: 0 } } }
  const f = mapFixture(raw)
  expect(f.htScore1).toBe(1)
  expect(f.htScore2).toBe(0)
})

test('mapFixture half-time score is null when absent', () => {
  const raw = { fixture: { id: 7, date: '2026-06-20T18:00:00Z', status: { short: 'NS', elapsed: null }, venue: {} },
    league: { round: 'Group Stage - 1' }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: {} }
  expect(mapFixture(raw).htScore1).toBeNull()
})

test('mapFixture captures the 90-minute (regulation) score from score.fulltime', () => {
  const raw = { fixture: { id: 8, date: '2026-06-20T18:00:00Z', status: { short: 'AET', elapsed: 120 }, venue: {} },
    league: { round: 'Round of 16' }, teams: { home: { id: 1, winner: true }, away: { id: 2, winner: false } },
    goals: { home: 2, away: 1 }, score: { halftime: { home: 0, away: 1 }, fulltime: { home: 1, away: 1 } } }
  const f = mapFixture(raw)
  expect(f.regScore1).toBe(1)
  expect(f.regScore2).toBe(1)
})

test('mapFixture regulation score is null when absent', () => {
  const raw = { fixture: { id: 9, date: '2026-06-20T18:00:00Z', status: { short: 'NS', elapsed: null }, venue: {} },
    league: { round: 'Group Stage - 1' }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: {} }
  expect(mapFixture(raw).regScore1).toBeNull()
})
