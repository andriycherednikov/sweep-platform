/**
 * Recognise a capability-link path and extract its token(s).
 * Shapes (D2): `/g/<memberToken>` and `/g/<memberToken>/admin/<adminToken>`.
 * Pure: no history/fetch side effects. Returns null when `pathname` is not a join link.
 * @param {string} pathname e.g. window.location.pathname
 * @returns {{ memberToken: string, adminToken: string|null } | null}
 */
export function parseJoinLink(pathname) {
  const seg = pathname.split('/').filter(Boolean)
  if (seg[0] !== 'g' || !seg[1]) return null
  if (seg.length === 2) return { memberToken: seg[1], adminToken: null }
  if (seg.length === 4 && seg[2] === 'admin' && seg[3]) {
    return { memberToken: seg[1], adminToken: seg[3] }
  }
  return null
}
