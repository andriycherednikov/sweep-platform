import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapGame, mapGameStatus } from '../src/providers/basketball-mapping.js'

const games = JSON.parse(readFileSync(new URL('./fixtures/apibasketball/games.json', import.meta.url))).response
const byId = (id) => games.find((g) => g.id === id)

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
