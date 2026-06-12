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

test('renders a DRAW support notification ("is backing" a Draw)', () => {
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ personId: 'p1', teamCode: 'DRAW', fixtureId: 'm1', action: 'pick' }) })
  expect(container.textContent).toContain('is backing')
  expect(container.textContent).toContain('Draw')
  // still anchored to the matchup
  expect(container.textContent).toContain('Brazil v Morocco')
})

test('renders a GOAL match notification with scorer, minute, score and a penalty tag', () => {
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ kind: 'match', event: 'goal', fixtureId: 'm1', teamCode: 'br', player: 'Neymar', assist: 'Vinicius', minute: 23, detail: 'Penalty', score: [1, 0] }) })
  expect(container.textContent).toContain('Goal!')
  expect(container.textContent).toContain('23')      // minute
  expect(container.textContent).toContain('Neymar')  // scorer name
  expect(container.textContent).toContain('1–0')     // score line
  expect(container.textContent).toContain('(P)')     // penalty tag from detail
})

test('renders a RED card match notification with player and minute', () => {
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ kind: 'match', event: 'card', fixtureId: 'm1', teamCode: 'br', player: 'Casemiro', minute: 55, card: 'red', detail: 'Red Card' }) })
  expect(container.textContent).toContain('Red card')
  expect(container.textContent).toContain('55')
  expect(container.textContent).toContain('Casemiro')
})

test('renders kick-off and full-time match notifications', () => {
  const { container } = render(<FloatingReactions />)
  act(() => { pushNotification({ kind: 'match', event: 'start', fixtureId: 'm1' }) })
  expect(container.textContent).toContain('Kick-off')
  act(() => { pushNotification({ kind: 'match', event: 'final', fixtureId: 'm1', score: [2, 1] }) })
  expect(container.textContent).toContain('Full time')
  expect(container.textContent).toContain('2–1')
})
