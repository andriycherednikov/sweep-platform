import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'

// Mock the whole client module; assert observable calls (no spyOn of ESM named imports).
vi.mock('./api/client.js', () => ({
  postSuperSession: vi.fn(async () => ({ super: true })),
  fetchSuperSweeps: vi.fn(async () => ([
    { id: 'sw_a', name: 'Office Sweep', kind: 'group', archivedAt: null, createdAt: '2026-06-01T00:00:00Z', memberLink: '/g/m', adminLink: '/g/m/admin/a' },
    { id: 'sw_b', name: 'Pub Sweep', kind: 'group', archivedAt: '2026-06-02T00:00:00Z', createdAt: '2026-06-01T00:00:00Z', memberLink: '/g/m2', adminLink: '/g/m2/admin/a2' },
  ])),
  createSweep: vi.fn(async () => ({ id: 'sw_c', name: 'New One', memberLink: '/g/new-member', adminLink: '/g/new-member/admin/new-admin' })),
  rotateSweepToken: vi.fn(async () => ({})),
  archiveSweep: vi.fn(async () => ({})),
  unarchiveSweep: vi.fn(async () => ({})),
  patchSweep: vi.fn(async () => ({})),
}))

import { SuperConsole } from './screens-super.jsx'
import * as client from './api/client.js'

const noop = () => {}
beforeEach(() => { vi.clearAllMocks() })

test('SuperConsole prompts for the super token when not yet authed', () => {
  const { getByPlaceholderText, getByRole, queryByText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  expect(getByPlaceholderText(/super token/i)).toBeTruthy()
  expect(getByRole('button', { name: /unlock/i })).toBeTruthy()
  // the list is not rendered until authed
  expect(queryByText('Office Sweep')).toBeNull()
})

test('submitting the token unlocks and lists the sweeps with kind + archived state', async () => {
  const { getByPlaceholderText, getByRole, findByText, getByText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  fireEvent.change(getByPlaceholderText(/super token/i), { target: { value: 'tok' } })
  fireEvent.click(getByRole('button', { name: /unlock/i }))
  expect(client.postSuperSession).toHaveBeenCalledWith('tok')
  expect(await findByText('Office Sweep')).toBeTruthy()
  expect(getByText('Pub Sweep')).toBeTruthy()
  expect(client.fetchSuperSweeps).toHaveBeenCalledTimes(1)
  // archived sweep is flagged
  expect(getByText(/Archived/)).toBeTruthy()
})

test('an autoToken prop auto-submits the super token and skips the prompt', async () => {
  const { findByText, queryByPlaceholderText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await waitFor(() => expect(client.postSuperSession).toHaveBeenCalledWith('secret'))
  expect(await findByText('Office Sweep')).toBeTruthy()
  expect(queryByPlaceholderText(/super token/i)).toBeNull()
})

test('creating a sweep surfaces copyable member + admin links', async () => {
  const { getByPlaceholderText, getByRole, findByText, getByDisplayValue } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep') // wait for unlock + initial load
  fireEvent.change(getByPlaceholderText(/new sweep name/i), { target: { value: 'New One' } })
  fireEvent.click(getByRole('button', { name: /create sweep/i }))
  await waitFor(() => expect(client.createSweep).toHaveBeenCalledWith('New One'))
  // both links are shown in readonly inputs (copyable)
  expect(await getByDisplayValue('/g/new-member')).toBeTruthy()
  expect(getByDisplayValue('/g/new-member/admin/new-admin')).toBeTruthy()
})

test('rotate shows the <=8h tail note and calls rotateSweepToken', async () => {
  const { getByText, getAllByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep')
  // tail note is visible in the console
  expect(getByText(/up to 8h/i)).toBeTruthy()
  const rotateButtons = getAllByRole('button', { name: /rotate member/i })
  fireEvent.click(rotateButtons[0])
  await waitFor(() => expect(client.rotateSweepToken).toHaveBeenCalledWith('sw_a', 'member'))
})

test('archive/unarchive call the right action per row state', async () => {
  const { getByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep')
  // active sweep (sw_a) shows Archive; archived sweep (sw_b) shows Restore
  fireEvent.click(getByRole('button', { name: /^Archive sw_a$/ }))
  await waitFor(() => expect(client.archiveSweep).toHaveBeenCalledWith('sw_a'))
  fireEvent.click(getByRole('button', { name: /^Restore sw_b$/ }))
  await waitFor(() => expect(client.unarchiveSweep).toHaveBeenCalledWith('sw_b'))
})

test('rename submits the new name via patchSweep', async () => {
  const { getByDisplayValue, getByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep')
  const nameInput = getByDisplayValue('Office Sweep')
  fireEvent.change(nameInput, { target: { value: 'Renamed Sweep' } })
  fireEvent.click(getByRole('button', { name: /^Save name sw_a$/ }))
  await waitFor(() => expect(client.patchSweep).toHaveBeenCalledWith('sw_a', { name: 'Renamed Sweep' }))
})
