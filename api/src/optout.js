// Wagers self-exclusion (responsible-gambling), server side.
// Mirrors the duration keys of the device-local web module (web/src/optout.js), but
// records the chosen window centrally on the person row so it survives across devices
// and is visible to admins. Binding: a new opt-out only ever EXTENDS the window.

export const OPT_OUT_DAYS = { '1d': 1, '3d': 3, '7d': 7, '14d': 14 }
export const OPT_OUT_DURATIONS = [...Object.keys(OPT_OUT_DAYS), 'forever']

// Far-future sentinel for an indefinite ('forever') exclusion — it compares greater than
// any real "until" date, so max()/`> now` checks treat it as never-expiring uniformly.
export const FOREVER = new Date('9999-12-31T00:00:00.000Z')

/**
 * Resolve a duration key to the timestamp the exclusion runs until.
 * @returns {Date|null} null for an unknown key (caller should reject).
 */
export function untilFor(duration, now = Date.now()) {
  if (duration === 'forever') return FOREVER
  const days = OPT_OUT_DAYS[duration]
  if (!days) return null
  return new Date(now + days * 86_400_000)
}

/** Whether a person row is currently self-excluded from Wagers. */
export function isExcluded(p, now = Date.now()) {
  const u = p?.excludedUntil
  return !!u && new Date(u).getTime() > now
}

/**
 * Binding combine: never shorten an existing window. Returns whichever of the existing
 * exclusion (if still in the future) or the requested one runs longer.
 */
export function extendUntil(existing, requested) {
  if (!existing) return requested
  const cur = new Date(existing)
  return cur.getTime() >= requested.getTime() ? cur : requested
}
