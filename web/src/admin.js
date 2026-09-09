// web/src/admin.js
// Whether this device is admin of the sweep it is looking at. It used to carry a count
// of photos awaiting moderation too; uploads go live now, so there is no queue to
// count and nothing to badge.
import { useState, useEffect } from 'react'
import { fetchAdminMe } from './api/client.js'

let state = { isAdmin: false }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn(state))

export function getAdminBadge() { return state }
export function onAdminBadge(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Re-check admin auth. Resolves to the new state. */
export async function refreshAdminBadge() {
  try {
    await fetchAdminMe() // throws (401/403) when this device is not the sweep's owner
    state = { isAdmin: true }
  } catch {
    state = { isAdmin: false }
  }
  emit()
  return state
}

export function useAdminBadge() {
  const [s, setS] = useState(state)
  useEffect(() => onAdminBadge(setS), [])
  return s
}
