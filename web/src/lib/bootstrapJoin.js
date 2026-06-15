import { parseJoinLink } from './joinLink.js'
import { addSweep } from '../sweeps.js'

/**
 * If `loc.pathname` is a capability link (D2), exchange the token for a session
 * cookie via `postSession`, persist the link token to the switcher store (D4),
 * then strip the token from the URL (replaceState → '/'). The admin token wins
 * when present. A failed exchange still strips the URL so no secret lingers.
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
    const { sweepId, role } = await postSession(token)
    // name is null here — bootstrap hasn't run yet; backfilled by the Gate (Task 1.4).
    addSweep({ sweepId, name: null, role, token })
  } catch {
    /* swallow — strip the URL regardless so the token isn't left visible */
  } finally {
    history.replaceState({}, '', '/')
  }
}
