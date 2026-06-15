// web/src/spoiler.js
// Device-global "spoiler protection" preference + ephemeral per-match reveal state.
// Mirrors the module-store pattern in sweeps.js / social.js: a localStorage-backed
// flag, a listeners Set, and a useSpoiler() hook that force-re-renders subscribers.
import { useState, useEffect } from 'react'

const KEY = 'sweep.spoiler.v1'
const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

// In-memory mirror so the toggle still works in-session when localStorage is
// unavailable (private mode). localStorage is the source of truth when readable.
let mem = false
function read() {
  try { return localStorage.getItem(KEY) === '1' } catch { return mem }
}

// Revealed fixture ids — in-memory only, so they reset on reload (the core promise).
const revealed = new Set()

/** @returns {boolean} whether spoiler protection is currently on */
export function isSpoiler() { return read() }

/** Turn the mode on/off. Enabling re-hides everything (clears the reveal set). */
export function setSpoiler(on) {
  const v = !!on
  mem = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private mode */ }
  if (v) revealed.clear()
  notify()
}

/** Reveal a single match's score for the rest of this session. */
export function reveal(id) { revealed.add(id); notify() }

/** @returns {boolean} whether `id` has been revealed this session */
export function isRevealed(id) { return revealed.has(id) }

/** Single source of truth: should this fixture's score be covered right now? */
export function spoilerHidden(f) {
  return isSpoiler()
    && !!f && (f.status === 'final' || f.status === 'live')
    && !!f.score && !revealed.has(f.id)
}

/** Reactive hook — re-renders the caller when the mode or reveal set changes. */
export function useSpoiler() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((x) => x + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
  return { on: isSpoiler(), setSpoiler, reveal }
}
