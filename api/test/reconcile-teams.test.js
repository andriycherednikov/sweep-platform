import { expect, test } from 'vitest'
import { reconcileTeams, normalizeName, matchKey } from '../src/worker/reconcile-teams.js'

test('normalizeName strips accents and punctuation', () => {
  expect(normalizeName('Türkiye')).toBe('turkiye')
  expect(normalizeName('Bosnia & Herzegovina')).toBe('bosnia herzegovina')
})

test('matchKey aliases Türkiye → turkey', () => {
  expect(matchKey('Türkiye')).toBe('turkey')
  expect(matchKey('Turkey')).toBe('turkey')
})

test('reconcile keeps matched codes, inserts new, deletes absent', () => {
  const ours = [
    { code: 'hr', name: 'Croatia', group: 'A' },     // matches → kept, regrouped to L
    { code: 'tr', name: 'Turkey', group: 'J' },       // alias-matches Türkiye → kept
    { code: 'it', name: 'Italy', group: 'I' },        // absent from real field → deleted
  ]
  const real = [
    { providerTeamId: 3001, name: 'Croatia', code: 'CRO', country: 'Croatia' },
    { providerTeamId: 3009, name: 'Türkiye', code: 'TUR', country: 'Türkiye' },
    { providerTeamId: 3020, name: 'Panama', code: 'PAN', country: 'Panama' }, // new → inserted
  ]
  const groupByProvider = new Map([[3001, 'L'], [3009, 'J'], [3020, 'A']])
  const { updates, inserts, deletes, stats } = reconcileTeams(ours, real, groupByProvider)

  expect(stats).toEqual({ matched: 2, inserted: 1, deleted: 1 })
  expect(updates).toContainEqual({ code: 'hr', name: 'Croatia', group: 'L', providerTeamId: 3001 })
  expect(updates).toContainEqual({ code: 'tr', name: 'Türkiye', group: 'J', providerTeamId: 3009 })
  expect(deletes).toEqual(['it'])
  expect(inserts).toHaveLength(1)
  expect(inserts[0]).toMatchObject({ code: 'pan', name: 'Panama', group: 'A', providerTeamId: 3020, strength: 70 })
})

test('derived codes never collide with existing codes', () => {
  const ours = [{ code: 'pan', name: 'Existing Pan', group: 'A' }]
  const real = [{ providerTeamId: 1, name: 'Panama', code: 'PAN', country: 'Panama' }]
  const { inserts } = reconcileTeams(ours, real, new Map([[1, 'B']]))
  expect(inserts[0].code).not.toBe('pan')   // 'pan' taken → fallback suffix
})
