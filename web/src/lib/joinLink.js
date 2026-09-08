/**
 * Recognise a capability-link path and extract its member token.
 * Shapes: `/g/<memberToken>` and the old `/g/<memberToken>/admin/<adminToken>` —
 * the admin segment no longer names anything the API accepts, so it is ignored
 * and the link degrades to its still-valid member token rather than dying.
 * Pure: no history/fetch side effects. Returns null when `pathname` is not a join link.
 * @param {string} pathname e.g. window.location.pathname
 * @returns {string|null} the member token, or null
 */
export function parseJoinLink(pathname) {
  const seg = pathname.split('/').filter(Boolean)
  if (seg[0] !== 'g' || !seg[1]) return null
  if (seg.length === 2) return seg[1]
  if (seg.length === 4 && seg[2] === 'admin' && seg[3]) return seg[1]
  return null
}

/**
 * Read the sweep id off its own path — `/s/<sweepId>` and anything under it.
 * Unlike a join link this is not a credential: possessing the id grants nothing
 * (the signed cookie does), so it is safe in a bookmark, a screenshot or history.
 * @param {string} pathname
 * @returns {string|null}
 */
export function parseSweepPath(pathname) {
  const seg = pathname.split('/').filter(Boolean)
  return seg[0] === 's' && seg[1] ? seg[1] : null
}

/**
 * Recognise a per-seat invite path: `/i/<inviteToken>`.
 * Unlike `/g/<memberToken>` this names ONE seat and one address — redeeming it both
 * signs that address in and claims the seat, so an invitee never retypes the address
 * the organiser already typed for them. Single-use and expiring, server-side.
 * @param {string} pathname
 * @returns {string|null} the invite token, or null
 */
export function parseInviteLink(pathname) {
  const seg = pathname.split('/').filter(Boolean)
  return seg.length === 2 && seg[0] === 'i' && seg[1] ? seg[1] : null
}
