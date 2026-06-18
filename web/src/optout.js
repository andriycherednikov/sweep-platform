// web/src/optout.js
// Device-local Wagers self-exclusion ("opt out"). Binding for the chosen period:
// no early reversal, and the remaining time is never surfaced. Mirrors the
// localStorage-backed module-store pattern in spoiler.js (flag + listeners + hook).
import { useState, useEffect } from 'react'

const KEY = 'sweep.wagers.optout.v1'
const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

// days per duration key; 'forever' is special-cased (indefinite, no auto-return)
export const OPT_OUT_DAYS = { '1d': 1, '3d': 3, '7d': 7, '14d': 14 }

// In-memory mirror so it still works in-session when localStorage is unavailable
// (private mode). localStorage is the source of truth when readable.
let mem = null // null = not opted out; 'forever'; or an epoch-ms expiry string
function read() {
  try { return localStorage.getItem(KEY) } catch { return mem }
}

/** @returns {boolean} whether Wagers is currently locked out on this device */
export function isOptedOut() {
  const v = read()
  if (!v) return false
  if (v === 'forever') return true
  return Number(v) > Date.now()
}

/** Opt out for a duration key (∈ keys of OPT_OUT_DAYS, or 'forever'). Binding. */
export function optOut(durationKey) {
  let v
  if (durationKey === 'forever') v = 'forever'
  else if (OPT_OUT_DAYS[durationKey]) v = String(Date.now() + OPT_OUT_DAYS[durationKey] * 86_400_000)
  else return // unknown key: ignore, never lock out on a typo
  mem = v
  try { localStorage.setItem(KEY, v) } catch { /* private mode — mem holds it */ }
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
