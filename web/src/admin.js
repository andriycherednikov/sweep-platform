// web/src/admin.js
// Tiny store for the admin moderation badge — whether the current device is
// authenticated as admin, and how many photos are awaiting moderation. The
// pending count needs the admin cookie, so it can't come from the public
// SWEEP.photos (approved-only). Refreshed on mount, after login/moderation, and
// on photo SSE events.
import { useState, useEffect } from 'react'
import { fetchAdminMe, fetchAdminPhotos } from './api/client.js'

let state = { isAdmin: false, pending: 0 }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn(state))

export function getAdminBadge() { return state }
export function onAdminBadge(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Re-check admin auth + pending count. Resolves to the new state. */
export async function refreshAdminBadge() {
  try {
    await fetchAdminMe() // throws (401) when not authenticated as admin
    const data = await fetchAdminPhotos()
    state = { isAdmin: true, pending: (data.pending || []).length }
  } catch {
    state = { isAdmin: false, pending: 0 }
  }
  emit()
  return state
}

export function useAdminBadge() {
  const [s, setS] = useState(state)
  useEffect(() => onAdminBadge(setS), [])
  return s
}
