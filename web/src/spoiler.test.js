import { expect, test, beforeEach } from 'vitest'
import {
  isSpoiler, setSpoiler, reveal, isRevealed, spoilerHidden,
} from './spoiler.js'

const fin = { id: 'm1', status: 'final', score: [2, 0] }
const liveFx = { id: 'm2', status: 'live', score: [1, 1] }
const up = { id: 'm3', status: 'upcoming', score: null }

beforeEach(() => {
  localStorage.clear()
  setSpoiler(false) // reset persisted flag + in-memory mirror
})

test('defaults ON when nothing is stored', () => {
  localStorage.clear()
  expect(isSpoiler()).toBe(true)
  expect(spoilerHidden(fin)).toBe(true)
})

test('setSpoiler(true) turns the mode on and persists', () => {
  setSpoiler(true)
  expect(isSpoiler()).toBe(true)
  expect(localStorage.getItem('sweep.spoiler.v1')).toBe('1')
  setSpoiler(false)
  expect(isSpoiler()).toBe(false)
})

test('hides final AND live fixtures (with a score) when on; never upcoming', () => {
  setSpoiler(true)
  expect(spoilerHidden(fin)).toBe(true)
  expect(spoilerHidden(liveFx)).toBe(true)
  expect(spoilerHidden(up)).toBe(false)
})

test('reveal(id) un-hides only that fixture', () => {
  setSpoiler(true)
  reveal('m1')
  expect(isRevealed('m1')).toBe(true)
  expect(spoilerHidden(fin)).toBe(false)   // m1 revealed
  expect(spoilerHidden(liveFx)).toBe(true) // m2 still hidden
})

test('enabling the mode clears previously revealed matches', () => {
  setSpoiler(true)
  reveal('m1')
  expect(isRevealed('m1')).toBe(true)
  setSpoiler(false)
  setSpoiler(true)            // re-enabling re-hides everything fresh
  expect(isRevealed('m1')).toBe(false)
  expect(spoilerHidden(fin)).toBe(true)
})

test('nothing is hidden while the mode is off', () => {
  setSpoiler(false)
  expect(spoilerHidden(fin)).toBe(false)
  expect(spoilerHidden(liveFx)).toBe(false)
})
