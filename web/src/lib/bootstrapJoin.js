import { parseJoinLink, parseInviteLink } from './joinLink.js'
import { addSweep } from '../sweeps.js'

/**
 * If `loc.pathname` is a capability link (D2), exchange the token for a session
 * cookie via `postSession`, persist the link token to the switcher store (D4),
 * then strip the token from the URL (replaceState → '/'). A failed exchange
 * still strips the URL so no secret lingers.
 *
 * @param {{ pathname: string }} loc   typically window.location
 * @param {History} history            typically window.history
 * @param {(token: string) => Promise<{sweepId:string, role:string}>} postSession
 * @returns {Promise<void>}
 */
export async function joinFromLocation(loc, history, postSession) {
  const token = parseJoinLink(loc.pathname)
  if (!token) return
  let failed = false
  let landing = '/'
  try {
    const { sweepId } = await postSession(token)
    // name and role are null here — bootstrap hasn't run yet and POST /api/session has
    // not returned a role since roles left the cookie; the Gate backfills both.
    addSweep({ sweepId, name: null, role: null, token })
    // The token still leaves the bar, but it lands on the sweep's own address rather
    // than on '/', which is the marketing front door and belongs to nobody's sweep.
    landing = `/s/${sweepId}`
  } catch {
    // The token still goes (never leave a secret in the bar), but the failure has to
    // outlive it: the Gate is about to see a plain 401 and, with nothing on the device,
    // would show this invitee the marketing page instead of "that link is dead".
    failed = true
  } finally {
    history.replaceState({}, '', failed ? '/?join=failed' : landing)
  }
}

/**
 * Redeem a `/i/<token>` invite before anything renders: it signs the invitee in AND
 * claims their seat, so they land inside the sweep as themselves. The token leaves the
 * address bar either way — it is single-use, but a spent credential in a screenshot is
 * still a credential in a screenshot.
 * @returns {Promise<void>}
 */
export async function inviteFromLocation(loc, history, postInviteSession) {
  const token = parseInviteLink(loc.pathname)
  if (!token) return
  let landing = '/?invite=failed'
  try {
    const { sweepId } = await postInviteSession(token)
    addSweep({ sweepId, name: null, role: null, token: null })
    landing = `/s/${sweepId}`
  } catch { /* expired, spent, or never real — the landing says so */ }
  history.replaceState({}, '', landing)
}
