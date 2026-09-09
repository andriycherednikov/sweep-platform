import { expect, test, vi, beforeEach } from 'vitest'
vi.mock('./api/client.js', () => ({ fetchAdminMe: vi.fn() }))
import { fetchAdminMe } from './api/client.js'
import { refreshAdminBadge, getAdminBadge, onAdminBadge } from './admin.js'

beforeEach(() => { vi.clearAllMocks() })

// The badge used to carry a count of photos awaiting moderation. Uploads go live now,
// so admin is the only thing left to know.
test('refreshAdminBadge sets isAdmin when this device owns the sweep', async () => {
  fetchAdminMe.mockResolvedValue({ admin: true })
  const seen = []
  const off = onAdminBadge((s) => seen.push({ ...s }))
  await refreshAdminBadge()
  expect(getAdminBadge()).toEqual({ isAdmin: true })
  expect(seen.at(-1)).toEqual({ isAdmin: true })
  off()
})

test('refreshAdminBadge resets to non-admin when the credential is rejected', async () => {
  fetchAdminMe.mockRejectedValue(new Error('401'))
  await refreshAdminBadge()
  expect(getAdminBadge()).toEqual({ isAdmin: false })
})
