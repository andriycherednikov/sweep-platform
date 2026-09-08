import { expect, test, vi, beforeEach } from 'vitest'

const KEY = 'sweep.sweeps.v1'

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

test('listSweeps is [] when nothing is stored', async () => {
  const { listSweeps } = await import('./sweeps.js')
  expect(listSweeps()).toEqual([])
})

test('addSweep appends a new entry', async () => {
  const { addSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' })
  expect(listSweeps()).toEqual([{ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' }])
})

test('addSweep upserts by sweepId: updates name/role, keeps token when new token is null', async () => {
  const { addSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: null, role: 'member', token: 'realtok' })
  addSweep({ sweepId: 'sw_1', name: 'Office Sweep', role: 'admin', token: null })
  expect(listSweeps()).toEqual([
    { sweepId: 'sw_1', name: 'Office Sweep', role: 'admin', token: 'realtok' },
  ])
})

test('addSweep overwrites the token only when a non-null token is provided', async () => {
  const { addSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'A', role: 'member', token: 'old' })
  addSweep({ sweepId: 'sw_1', name: 'A', role: 'admin', token: 'new' })
  expect(listSweeps()[0].token).toBe('new')
})

test('removeSweep drops the matching entry', async () => {
  const { addSweep, removeSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'A', role: 'member', token: 't1' })
  addSweep({ sweepId: 'sw_2', name: 'B', role: 'member', token: 't2' })
  removeSweep('sw_1')
  expect(listSweeps()).toEqual([{ sweepId: 'sw_2', name: 'B', role: 'member', token: 't2' }])
})

test('listSweeps tolerates corrupt JSON → []', async () => {
  localStorage.setItem(KEY, '{not json')
  const { listSweeps } = await import('./sweeps.js')
  expect(listSweeps()).toEqual([])
})

test('renameSweep updates the local label', async () => {
  const { addSweep, renameSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'Old', role: 'member', token: 't1' })
  renameSweep('sw_1', 'New Name')
  expect(listSweeps()[0].name).toBe('New Name')
})

test('addSweep keeps an existing name when re-joined with name:null', async () => {
  const { addSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'Real Name', role: 'admin', token: 't1' })
  addSweep({ sweepId: 'sw_1', name: null, role: 'admin', token: 't1' }) // re-join (name not yet known)
  expect(listSweeps()[0].name).toBe('Real Name')
})

// Switching used to be a cache invalidation, which left the URL pointing at the sweep
// you just left and one cache serving two sweeps. The sweep is an address now, so
// switching is a navigation to it — Back crosses a switch correctly and nothing bleeds.
test('switchTo posts the stored token then navigates to the sweep', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_2', role: 'member' }))
  vi.doMock('./api/client.js', () => ({ postSession }))
  const assign = vi.fn()
  const original = window.location
  delete window.location
  window.location = { ...original, assign }
  const { switchTo } = await import('./sweeps.js')
  await switchTo({ sweepId: 'sw_2', name: 'B', role: 'member', token: 'tok2' })
  expect(postSession).toHaveBeenCalledWith('tok2')
  expect(assign).toHaveBeenCalledWith('/s/sw_2')
  window.location = original
})
