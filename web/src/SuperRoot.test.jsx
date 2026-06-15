import { expect, test, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// SuperRoot renders the super console standalone (outside the sweep Gate), so
// the platform owner can reach it with only a super cookie — no sweep session.
vi.mock('./api/client.js', () => ({
  postSuperSession: vi.fn(async () => ({ super: true })),
  fetchSuperSweeps: vi.fn(async () => ([])),
  createSweep: vi.fn(async () => ({})),
  rotateSweepToken: vi.fn(async () => ({})),
  archiveSweep: vi.fn(async () => ({})),
  unarchiveSweep: vi.fn(async () => ({})),
  patchSweep: vi.fn(async () => ({})),
}))

import { SuperRoot } from './SuperRoot.jsx'
import * as client from './api/client.js'

beforeEach(() => { vi.clearAllMocks() })

test('SuperRoot shows the super token gate when no autoToken is given', () => {
  const { getByPlaceholderText } = render(<SuperRoot />)
  expect(getByPlaceholderText(/super token/i)).toBeTruthy()
})

test('SuperRoot auto-submits a deep-link token (no sweep session required)', async () => {
  render(<SuperRoot autoToken="sekret" />)
  await waitFor(() => expect(client.postSuperSession).toHaveBeenCalledWith('sekret'))
})
