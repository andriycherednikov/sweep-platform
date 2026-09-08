import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'

// Mock the whole client module; assert observable calls (no spyOn of ESM named imports).
vi.mock('./api/client.js', () => ({
  // The real listing carries no link field at all — a live member token in the
  // operator console is the ability to enter a customer's sweep as one of its
  // members, which the API deliberately stopped handing out.
  fetchSuperSweeps: vi.fn(async () => ([
    { id: 'sw_a', name: 'Office Sweep', kind: 'group', archivedAt: null, createdAt: '2026-06-01T00:00:00Z', accountId: 'acc_1', competitionId: 'c1' },
    { id: 'sw_b', name: 'Pub Sweep', kind: 'group', archivedAt: '2026-06-02T00:00:00Z', createdAt: '2026-06-01T00:00:00Z', accountId: 'acc_2', competitionId: 'c1' },
  ])),
  archiveSweep: vi.fn(async () => ({})),
  unarchiveSweep: vi.fn(async () => ({})),
  patchSweep: vi.fn(async () => ({})),
}))

import { SuperConsole } from './screens-super.jsx'
import * as client from './api/client.js'

const noop = () => {}
beforeEach(() => { vi.clearAllMocks() })

// There is no token to submit any more: an operator is an ordinary account whose role
// the server checks. The console just tries the listing and reads what came back.
test('lists the sweeps straight away, with kind + archived state, no sign-in step', async () => {
  const { findByText, getByText, queryByPlaceholderText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  expect(await findByText('Office Sweep')).toBeTruthy()
  expect(getByText('Pub Sweep')).toBeTruthy()
  expect(client.fetchSuperSweeps).toHaveBeenCalledTimes(1)
  expect(getByText(/Archived/)).toBeTruthy()
  expect(queryByPlaceholderText(/token/i)).toBeNull()
})

test('a 401 (signed out) points at /account instead of prompting for a token', async () => {
  client.fetchSuperSweeps.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
  const { findByRole, queryByText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  expect(await findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/account')
  expect(queryByText('Office Sweep')).toBeNull()
})

test('a 403 (signed in, not an operator) says so — and never invites signing in again', async () => {
  client.fetchSuperSweeps.mockRejectedValueOnce(Object.assign(new Error('HTTP 403'), { status: 403 }))
  const { findByText, queryByRole } = render(<SuperConsole onBack={noop} onToast={noop} />)
  expect(await findByText(/not an operator/i)).toBeTruthy()
  expect(queryByRole('link', { name: /sign in/i })).toBeNull()
})

test('no create-sweep form and no rotate buttons — those routes are gone', async () => {
  const { findByText, queryByPlaceholderText, queryByRole, queryByDisplayValue } = render(<SuperConsole onBack={noop} onToast={noop} />)
  await findByText('Office Sweep')
  expect(queryByPlaceholderText(/new sweep name/i)).toBeNull()
  expect(queryByRole('button', { name: /create sweep/i })).toBeNull()
  expect(queryByRole('button', { name: /rotate/i })).toBeNull()
  // no member/admin link field anywhere in the console
  expect(queryByDisplayValue(/^\/g\//)).toBeNull()
})

test('archive/unarchive call the right action per row state', async () => {
  const { getByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  await findByText('Office Sweep')
  // active sweep (sw_a) shows Archive; archived sweep (sw_b) shows Restore
  fireEvent.click(getByRole('button', { name: /^Archive sw_a$/ }))
  await waitFor(() => expect(client.archiveSweep).toHaveBeenCalledWith('sw_a'))
  fireEvent.click(getByRole('button', { name: /^Restore sw_b$/ }))
  await waitFor(() => expect(client.unarchiveSweep).toHaveBeenCalledWith('sw_b'))
})

test('rename submits the new name via patchSweep', async () => {
  const { getByDisplayValue, getByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  await findByText('Office Sweep')
  const nameInput = getByDisplayValue('Office Sweep')
  fireEvent.change(nameInput, { target: { value: 'Renamed Sweep' } })
  fireEvent.click(getByRole('button', { name: /^Save name sw_a$/ }))
  await waitFor(() => expect(client.patchSweep).toHaveBeenCalledWith('sw_a', { name: 'Renamed Sweep' }))
})
