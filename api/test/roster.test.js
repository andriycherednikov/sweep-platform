import { expect, test } from 'vitest'
import { roster } from '../src/seed/roster.js'
import { toPerson } from '../src/seed/import-roster.js'

// The real 48 WC-2026 team codes (must match the `team` table after the cutover).
const VALID = new Set([
  'dz', 'ar', 'au', 'at', 'be', 'bih', 'br', 'ca', 'cpv', 'co', 'cgo', 'hr', 'cur', 'cze',
  'ec', 'eg', 'gb-eng', 'fr', 'de', 'gh', 'hai', 'ir', 'irq', 'ci', 'jp', 'jor', 'mx', 'ma',
  'nl', 'nz', 'no', 'pan', 'py', 'pt', 'qa', 'sa', 'sco', 'sn', 'za', 'kr', 'es', 'se', 'ch',
  'tn', 'tr', 'uy', 'us', 'uzb',
])

test('roster: 48 players, each with exactly two team codes', () => {
  expect(roster).toHaveLength(48)
  for (const r of roster) expect(r.teams, r.name).toHaveLength(2)
})

test('roster: every pick references a real WC-2026 team code', () => {
  for (const r of roster) for (const c of r.teams) expect(VALID.has(c), `${r.name} → ${c}`).toBe(true)
})

test('roster: every one of the 48 teams is owned by exactly two players', () => {
  const count = {}
  for (const r of roster) for (const c of r.teams) count[c] = (count[c] ?? 0) + 1
  expect(Object.keys(count).length).toBe(48)
  for (const [code, n] of Object.entries(count)) expect(n, `${code} owned ${n}×`).toBe(2)
})

test('roster: player names are unique', () => {
  const names = roster.map((r) => r.name)
  expect(new Set(names).size).toBe(names.length)
})

test('toPerson builds id, initials, and short form', () => {
  expect(toPerson('Andriy Cherednikov', 0)).toMatchObject({ id: 'p1', initials: 'AC', short: 'Andriy C.' })
  expect(toPerson('Havill Family', 2)).toMatchObject({ id: 'p3', initials: 'HF' })
})
