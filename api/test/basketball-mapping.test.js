import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapGame, mapGameStatus, mapBasketTeam, mapBasketStanding, mapLeague } from '../src/providers/basketball-mapping.js'

const games = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/games.json', import.meta.url))).response
const byId = (id) => games.find((g) => g.id === id)
const teams = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/teams.json', import.meta.url))).response
const standings = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/standings.json', import.meta.url))).response
const leagues = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/leagues.json', import.meta.url))).response

test('mapGameStatus buckets basketball status shorts', () => {
  expect(mapGameStatus('NS')).toBe('upcoming')
  expect(mapGameStatus('Q3')).toBe('live')
  expect(mapGameStatus('HT')).toBe('live')
  expect(mapGameStatus('OT')).toBe('live')
  expect(mapGameStatus('FT')).toBe('final')
  expect(mapGameStatus('AOT')).toBe('final')
  expect(mapGameStatus('POST')).toBe('upcoming')
})

test('mapGame maps a regular-season final onto the football-core shape', () => {
  const g = mapGame(byId(372186)) // Timberwolves 111–99 Mavericks
  expect(g).toMatchObject({
    id: '372186', homeProviderId: 149, awayProviderId: 138,
    status: 'final', winnerSide: 'home', score1: 111, score2: 99,
    stage: 'group', group: '', matchday: 0, city: '', minute: null, phase: null,
  })
  expect(g.kickoffUtc).toEqual(new Date('2023-10-05T16:00:00+00:00'))
  expect(g.detail.quarters).toEqual({ home: [37, 29, 21, 24], away: [19, 30, 25, 25] })
  expect(g.detail.ot).toBeNull()
  expect(g.detail.week).toBeNull()
})

test('mapGame: overtime final carries ot pair; playoff week → knockout stage', () => {
  const aot = mapGame(byId(372190)) // Pistons 126–130 Suns AOT
  expect(aot.status).toBe('final')
  expect(aot.winnerSide).toBe('away')
  expect(aot.detail.ot).toEqual([
    byId(372190).scores.home.over_time, byId(372190).scores.away.over_time,
  ])
  const po = mapGame(byId(399891)) // Celtics v Mavs, week 'NBA - Final'
  expect(po.stage).toBe('knockout')
  expect(po.detail.week).toBe('NBA - Final')
})

test('mapGame throws on a tied final (corrupt feed for a no-draw sport)', () => {
  const raw = structuredClone(byId(372186))
  raw.scores.away.total = raw.scores.home.total
  expect(() => mapGame(raw)).toThrow(/tied/)
})

test('mapBasketTeam maps franchises and nulls the All-Star squads', () => {
  const mapped = teams.map(mapBasketTeam)
  const real = mapped.filter(Boolean)
  expect(real).toHaveLength(30) // 32 raw − East − West
  const okc = real.find((t) => t.name === 'Oklahoma City Thunder')
  expect(okc).toMatchObject({ providerTeamId: 152, code: null, country: 'USA' })
  expect(okc.logo).toMatch(/^https:/)
  expect(teams.filter((t) => t.name === 'East' || t.name === 'West').map(mapBasketTeam)).toEqual([null, null])
})

test('mapBasketStanding keeps conference rows only, with rank and W/L stats', () => {
  const rows = standings[0].map(mapBasketStanding).filter(Boolean)
  expect(rows).toHaveLength(30) // 60 raw − 30 division rows
  const top = rows.find((r) => r.providerTeamId === 152) // OKC, #1 West
  expect(top).toMatchObject({ group: 'Western Conference', rank: 1, pts: 0 })
  expect(top.stats).toEqual({ played: 82, win: 57, loss: 25, pf: 9847, pa: 9239, pct: 0.695 })
})

test('mapLeague maps the catalog entry', () => {
  const l = mapLeague(leagues[0])
  expect(l).toMatchObject({ providerLeagueId: 12, name: 'NBA', type: 'League' })
  expect(l.seasons.map((s) => s.season)).toContain('2023-2024')
})
