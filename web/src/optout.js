// web/src/optout.js
// Per-person Wagers self-exclusion ("opt out"), stored locally on the device.
// Binding for the chosen period: no early reversal, and the remaining time is never
// surfaced. Keyed by the person you're signed in as — opting out affects only that
// identity, so switching to a different person restores their own access.
// Mirrors the localStorage-backed module-store pattern in spoiler.js.
import { useState, useEffect } from 'react'
import { getMe } from './social.js'
import { SWEEP as S } from './data.js'
import { postOptout } from './api/client.js'

const KEY = 'sweep.wagers.optout.v2' // map { personId: 'forever' | expiryMs }
const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

// days per duration key; 'forever' is special-cased (indefinite, no auto-return)
export const OPT_OUT_DAYS = { '1d': 1, '3d': 3, '7d': 7, '14d': 14 }

// In-memory mirror so it still works in-session when localStorage is unavailable
// (private mode). localStorage is the source of truth when readable.
let mem = {} // { personId: 'forever' | epoch-ms expiry }
function readMap() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return (parsed && typeof parsed === 'object') ? parsed : {}
  } catch { return mem }
}
function writeMap(map) {
  mem = map
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* private mode — mem holds it */ }
}

/**
 * @param {string} [personId] defaults to the person you're signed in as
 * @returns {boolean} whether Wagers is currently locked out for that person
 */
export function isOptedOut(personId) {
  const id = personId ?? getMe()?.id
  if (!id) return false
  // The server-recorded exclusion is authoritative across devices: if any device
  // opted this person out, honour it here too. (Only ever ADDS a lock — a person the
  // server says is excluded can never be un-excluded by the absence of a local entry.)
  if (S.peopleById?.[id]?.excluded) return true
  const v = readMap()[id]
  if (!v) return false
  if (v === 'forever') return true
  return Number(v) > Date.now()
}

/**
 * Opt the given person out for a duration key (∈ keys of OPT_OUT_DAYS, or 'forever').
 * Binding. Defaults to the person you're signed in as.
 */
export function optOut(durationKey, personId) {
  const id = personId ?? getMe()?.id
  if (!id) return // no identity → nothing to opt out
  let v
  if (durationKey === 'forever') v = 'forever'
  else if (OPT_OUT_DAYS[durationKey]) v = Date.now() + OPT_OUT_DAYS[durationKey] * 86_400_000
  else return // unknown key: ignore, never lock out on a typo
  const map = readMap()
  map[id] = v
  writeMap(map)
  // Record it centrally too, so it survives across devices and is visible to admins.
  // Fire-and-forget: the local write above is the immediate, offline-safe gate, so a
  // network/parse failure here is swallowed (IIFE also catches a synchronous throw).
  ;(async () => { try { await postOptout(id, durationKey) } catch { /* offline — local gate holds */ } })()
  notify()
}

/** Reactive hook — re-renders the caller when the opt-out state changes. */
export function useOptOut() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((x) => x + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
  return { optedOut: isOptedOut() }
}
