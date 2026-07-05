import { describe, it, expect } from 'vitest'
import { vocabFor } from './vocab.js'

describe('vocabFor', () => {
  it('football keeps soccer terms', () => {
    const v = vocabFor('football')
    expect(v.noun).toBe('match'); expect(v.finalLabel).toBe('Full time'); expect(v.ftShort).toBe('FT')
    expect(v.standingsCols.map(([k]) => k)).toEqual(['played', 'win', 'draw', 'loss', 'gf', 'ga', 'pts'])
    expect(v.live({ phase: 'HT', minute: 45 })).toBe('HT')
  })
  it('basketball is 2-way and quarter-based', () => {
    const v = vocabFor('basketball')
    expect(v.noun).toBe('game'); expect(v.finalLabel).toBe('Final'); expect(v.koTabLabel).toBe('Playoffs')
    expect(v.standingsCols.map(([k]) => k)).toEqual(['played', 'win', 'loss', 'pct', 'pf', 'pa'])
    expect(v.live({ phase: 'Q3', minute: null })).toBe('Q3')
    expect(v.live({ phase: null, minute: null })).toBe('')
  })
  it('unknown sport falls back to generic 2-way', () => {
    expect(vocabFor('handegg').noun).toBe('game')
  })
})
