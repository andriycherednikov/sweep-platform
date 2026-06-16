import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  bulkPostOwnership: vi.fn(async () => ({ inserted: 0 })),
}))

import { SweepDraw } from './SweepDraw.jsx'
import { SWEEP as S, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { bulkPostOwnership } from './api/client.js'

const team = (code) => ({ code, name: code.toUpperCase(), group: 'A', pool: 'P', color: '#123', strength: 70, squad: null })

function setup(ownership) {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: ['t0', 't1', 't2', 't3', 't4', 't5'].map(team),
      people: [
        { id: 'a', name: 'Ann', short: 'Ann', initials: 'AN', av: '#a11' },
        { id: 'b', name: 'Bob', short: 'Bob', initials: 'BO', av: '#b22' },
        { id: 'c', name: 'Cy', short: 'Cy', initials: 'CY', av: '#c33' },
      ],
      ownership, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
}

const noop = () => {}

beforeEach(() => {
  bulkPostOwnership.mockClear()
})

test('Run previews a draft (flags dealt) without persisting anything', () => {
  setup({ b: ['t0'], c: ['t1', 't2'] }) // a needs 2, b needs 1, c needs 0 → 3 new at N=2
  const { getByText, container } = render(<SweepDraw onToast={noop} queryClient={{ invalidateQueries: vi.fn() }} />)
  act(() => { fireEvent.click(getByText('Run sweep')) })
  act(() => { fireEvent.click(getByText('Skip animation')) })
  expect(container.querySelectorAll('.sweep-new-flag')).toHaveLength(3)
  expect(bulkPostOwnership).not.toHaveBeenCalled()
})

test('Re-roll keeps it unsaved; Confirm persists the drafted items and refreshes', async () => {
  setup({ b: ['t0'], c: ['t1', 't2'] })
  const qc = { invalidateQueries: vi.fn() }
  const { getByText } = render(<SweepDraw onToast={noop} queryClient={qc} />)
  act(() => { fireEvent.click(getByText('Run sweep')) })
  act(() => { fireEvent.click(getByText('Skip animation')) })
  act(() => { fireEvent.click(getByText('Re-roll')) })
  act(() => { fireEvent.click(getByText('Skip animation')) })
  expect(bulkPostOwnership).not.toHaveBeenCalled()

  await act(async () => { fireEvent.click(getByText('Confirm')) })
  expect(bulkPostOwnership).toHaveBeenCalledTimes(1)
  const items = bulkPostOwnership.mock.calls[0][0]
  expect(items).toHaveLength(3)
  for (const it of items) {
    expect(it).toHaveProperty('personId')
    expect(it).toHaveProperty('teamCode')
  }
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
})

test('Run is disabled when everyone already has N teams', () => {
  setup({ a: ['t0', 't1'], b: ['t2', 't3'], c: ['t4', 't5'] }) // all at 2 → default N = round(6/3) = 2
  const { getByText } = render(<SweepDraw onToast={noop} queryClient={{ invalidateQueries: vi.fn() }} />)
  const btn = getByText('Run sweep')
  expect(btn).toBeDisabled()
  expect(S.people.every((p) => p.teams.length === 2)).toBe(true)
})

test('team rows list the names of the people who own them', () => {
  setup({ b: ['t0'], c: ['t1', 't2'] }) // Bob owns t0; Cy owns t1, t2
  const { container } = render(<SweepDraw onToast={noop} queryClient={{ invalidateQueries: vi.fn() }} />)
  const chips = [...container.querySelectorAll('.sweep-pool-owners .sweep-owner-chip')].map((e) => e.textContent)
  expect(chips.join(' ')).toContain('Bob')
  expect(chips.join(' ')).toContain('Cy')
})

test('the default N is the count that spreads teams most evenly (round teams/people)', () => {
  setup({}) // 6 teams, 3 people → round(2) = 2
  const { container } = render(<SweepDraw onToast={noop} queryClient={{ invalidateQueries: vi.fn() }} />)
  expect(container.querySelector('.sweep-n-val').textContent).toBe('2')
})
