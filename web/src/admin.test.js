import { expect, test, vi, beforeEach } from 'vitest'
vi.mock('./api/client.js', () => ({ fetchAdminMe: vi.fn(), fetchAdminPhotos: vi.fn() }))
import { fetchAdminMe, fetchAdminPhotos } from './api/client.js'
import { refreshAdminBadge, getAdminBadge, onAdminBadge } from './admin.js'

beforeEach(() => { vi.clearAllMocks() })

test('refreshAdminBadge sets isAdmin + pending count when authenticated', async () => {
  fetchAdminMe.mockResolvedValue({ admin: true })
  fetchAdminPhotos.mockResolvedValue({ pending: [1, 2, 3], approved: [9] })
  const seen = []
  const off = onAdminBadge((s) => seen.push({ ...s }))
  await refreshAdminBadge()
  expect(getAdminBadge()).toEqual({ isAdmin: true, pending: 3 })
  expect(seen.at(-1)).toEqual({ isAdmin: true, pending: 3 })
  off()
})

test('refreshAdminBadge resets to non-admin when the cookie is invalid', async () => {
  fetchAdminMe.mockRejectedValue(new Error('401'))
  await refreshAdminBadge()
  expect(getAdminBadge()).toEqual({ isAdmin: false, pending: 0 })
  expect(fetchAdminPhotos).not.toHaveBeenCalled()
})
