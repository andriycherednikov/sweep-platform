import { expect, test } from 'vitest'
import { flag, gd, fmtTime, fmtDay, fmtDayKey, fmtWeekday } from './format.js'

test('flag builds flagcdn urls (gb- subteams use svg)', () => {
  expect(flag('hr')).toBe('https://flagcdn.com/w80/hr.png')
  expect(flag('gb-eng')).toBe('https://flagcdn.com/gb-eng.svg')
})

test('flag maps non-ISO team codes to valid flagcdn codes', () => {
  expect(flag('cze', 40)).toBe('https://flagcdn.com/w40/cz.png') // Czech Republic
  expect(flag('cgo')).toBe('https://flagcdn.com/w80/cd.png')     // Congo DR
  expect(flag('sco')).toBe('https://flagcdn.com/gb-sct.svg')     // Scotland → svg
})

test('gd is goal difference', () => {
  expect(gd({ gf: 5, ga: 2 })).toBe(3)
})

test('Sydney formatters are stable for a known instant', () => {
  const d = new Date('2026-06-13T06:30:00Z') // 16:30 Sydney (UTC+10)
  expect(fmtDayKey(d)).toBe('2026-06-13')
  expect(fmtWeekday(d)).toBe('Saturday')
  expect(fmtDay(d)).toMatch(/Sat/)
  expect(fmtTime(d)).toMatch(/4:30/)
})
