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

test('switchTo posts the stored token then invalidates sweep + social queries', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_2', role: 'member' }))
  vi.doMock('./api/client.js', () => ({ postSession }))
  const { switchTo } = await import('./sweeps.js')
  const queryClient = { invalidateQueries: vi.fn() }
  await switchTo({ sweepId: 'sw_2', name: 'B', role: 'member', token: 'tok2' }, queryClient)
  expect(postSession).toHaveBeenCalledWith('tok2')
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['social'] })
})
