import { parseJoinLink } from './joinLink.js'

/**
 * If `loc.pathname` is a capability link (D2), exchange the token for a session
 * cookie via `postSession`, then strip the token from the URL (replaceState → '/').
 * The admin token wins when present. Even a failed exchange strips the URL so no
 * secret lingers in the address bar; the Gate (Task 1.4) then shows "pick a sweep".
 *
 * @param {{ pathname: string }} loc   typically window.location
 * @param {History} history            typically window.history
 * @param {(token: string) => Promise<{sweepId:string, role:string}>} postSession
 * @returns {Promise<void>}
 */
export async function joinFromLocation(loc, history, postSession) {
  const link = parseJoinLink(loc.pathname)
  if (!link) return
  const token = link.adminToken || link.memberToken
  try {
    await postSession(token)
  } catch {
    /* swallow — strip the URL regardless so the token isn't left visible */
  } finally {
    history.replaceState({}, '', '/')
  }
}
