import { expect, test } from 'vitest'
import { flag, gd, fmtTime, fmtDate, fmtDateTime, fmtDayKey, fmtWeekday, whenLabel } from './format.js'

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

test('formatters are stable for a known instant (TZ pinned to Sydney in setup)', () => {
  const d = new Date('2026-06-13T06:30:00Z') // 16:30 Sydney (UTC+10)
  expect(fmtDayKey(d)).toBe('2026-06-13')
  expect(fmtWeekday(d)).toBe('Saturday')
  expect(fmtDate(d)).toBe('Sat, 13 June')        // weekday short · day · FULL month
  expect(fmtTime(d)).toBe('4:30 PM')
  expect(fmtDateTime(d)).toBe('Sat, 13 June · 4:30 PM')
})

test('whenLabel appends FT / live minute / nothing by status', () => {
  const ko = new Date('2026-06-13T06:30:00Z')
  const base = 'Sat, 13 June · 4:30 PM'
  expect(whenLabel({ ko, status: 'upcoming' })).toBe(base)
  expect(whenLabel({ ko, status: 'final' })).toBe(base + ' · FT')
  expect(whenLabel({ ko, status: 'live', minute: 67 })).toBe(base + " · 67'")
})

test('whenLabel prefers a precomputed dateTimeLabel when present', () => {
  expect(whenLabel({ dateTimeLabel: 'Sun, 14 June · 8:00 AM', status: 'upcoming' }))
    .toBe('Sun, 14 June · 8:00 AM')
})
