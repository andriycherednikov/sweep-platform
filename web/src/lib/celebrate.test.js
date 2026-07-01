import { expect, test, vi, beforeEach } from 'vitest'

vi.mock('canvas-confetti', () => ({ default: vi.fn() }))
import confetti from 'canvas-confetti'
import { celebrate } from './celebrate.js'

const setReducedMotion = (reduce) => {
  window.matchMedia = (q) => ({
    matches: reduce && q.includes('reduce'),
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })
}

beforeEach(() => vi.clearAllMocks())

test('celebrate fires confetti when motion is allowed', () => {
  setReducedMotion(false)
  celebrate()
  expect(confetti).toHaveBeenCalled()
})

test('celebrate is a no-op under prefers-reduced-motion', () => {
  setReducedMotion(true)
  celebrate()
  expect(confetti).not.toHaveBeenCalled()
})
