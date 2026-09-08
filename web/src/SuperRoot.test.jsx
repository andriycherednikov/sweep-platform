import { expect, test, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// SuperRoot renders the super console standalone (outside the sweep Gate), so the
// operator can reach it without a sweep session — it now runs on an ordinary account
// session (x-account-token), not a super cookie or a token in the URL.
vi.mock('./api/client.js', () => ({
  fetchSuperSweeps: vi.fn(async () => ([])),
  archiveSweep: vi.fn(async () => ({})),
  unarchiveSweep: vi.fn(async () => ({})),
  patchSweep: vi.fn(async () => ({})),
}))

import { SuperRoot } from './SuperRoot.jsx'
import * as client from './api/client.js'

beforeEach(() => { vi.clearAllMocks() })

test('SuperRoot lists sweeps straight away (no sweep session, no token prompt)', async () => {
  const { findByText } = render(<SuperRoot />)
  await waitFor(() => expect(client.fetchSuperSweeps).toHaveBeenCalled())
  expect(await findByText(/no sweeps yet/i)).toBeTruthy()
})

test('a signed-out SuperRoot points at /account instead of asking for a token', async () => {
  client.fetchSuperSweeps.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
  const { findByRole } = render(<SuperRoot />)
  expect(await findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/account')
})
