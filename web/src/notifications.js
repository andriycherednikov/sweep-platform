// web/src/notifications.js
// Tiny pub/sub for ephemeral "floating reaction" notifications. Fed by the single
// SSE connection (useEventStream) and consumed by <FloatingReactions/>. Kept
// separate from social.js so the live-data cache and the ambient UI don't couple.

let seq = 0
const listeners = new Set()

export function onNotification(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Broadcast a reaction. Caller passes the payload; we stamp a unique id. */
export function pushNotification(payload) {
  const note = { id: `n${++seq}`, ...payload }
  listeners.forEach((fn) => fn(note))
  return note
}
