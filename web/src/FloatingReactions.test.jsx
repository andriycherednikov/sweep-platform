import { expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { FloatingReactions } from './FloatingReactions.jsx'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { pushNotification } from './notifications.js'

beforeEach(() => {
  vi.useFakeTimers()
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'br', name: 'Brazil', group: 'G', pool: 'P', color: '#0a7', strength: 80 },
        { code: 'ma', name: 'Morocco', group: 'G', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [{ id: 'p1', name: 'Hugo W', short: 'Hugo', initials: 'H', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'G', matchday: 1, t1: 'br', t2: 'ma', ko: '2026-06-12T18:00:00Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' }],
    standings: {}, photos: [],
  }))
})
afterEach(() => { vi.useRealTimers() })

test('renders a reaction for a pushed notification, then clears it after its lifetime', () => {
  const { container, queryByText } = render(<FloatingReactions />)
  act(() => { pushNotification({ personId: 'p1', teamCode: 'br', fixtureId: 'm1', action: 'pick' }) })
  expect(queryByText('Brazil')).toBeTruthy()
  expect(container.textContent).toContain('is backing')
  expect(container.textContent).toContain('Brazil v Morocco')
  act(() => { vi.advanceTimersByTime(4600) })
  expect(queryByText('Brazil')).toBeNull()
})

test('uses "switched to" copy for a switch', () => {
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ personId: 'p1', teamCode: 'br', fixtureId: 'm1', action: 'switch' }) })
  expect(container.textContent).toContain('switched to')
})

test('silently skips a notification it cannot resolve', () => {
  const { queryByText } = render(<FloatingReactions />)
  act(() => { pushNotification({ personId: 'nobody', teamCode: 'br', fixtureId: 'm1', action: 'pick' }) })
  expect(queryByText('Brazil')).toBeNull()
})
