import { expect, test } from 'vitest'
test('vitest runs in jsdom', () => {
  expect(typeof document).toBe('object')
})
