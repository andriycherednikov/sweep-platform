import { expect, test, vi } from 'vitest'
import { onNotification, pushNotification } from './notifications.js'

test('pushNotification delivers a stamped note to subscribers', () => {
  const seen = []
  const off = onNotification((n) => seen.push(n))
  const note = pushNotification({ personId: 'p1', teamCode: 'br' })
  expect(note.id).toMatch(/^n\d+$/)
  expect(seen).toHaveLength(1)
  expect(seen[0]).toMatchObject({ personId: 'p1', teamCode: 'br', id: note.id })
  off()
})

test('unsubscribe stops further delivery', () => {
  const fn = vi.fn()
  const off = onNotification(fn)
  pushNotification({ personId: 'p1' })
  off()
  pushNotification({ personId: 'p2' })
  expect(fn).toHaveBeenCalledTimes(1)
})
