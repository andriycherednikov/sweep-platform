import { getAccountToken } from '../lib/accountClient.js'

/**
 * Which sweep this browser is currently looking at. The cookie can hold several
 * (a person is in more than one group), so the cookie alone no longer identifies
 * one — every request names it. Unpinned means "whichever the server saw last",
 * which is what the default sweep, alone on its own host, has always relied on.
 */
let activeSweepId = null

/** Pin this when the URL names no sweep. It is not a sweep id (ids are `sw_`-prefixed),
 *  so on the platform host it resolves to nobody — which is the truth: the front door
 *  belongs to no sweep, and must not quietly open whichever one you last used. The
 *  default-sweep host ignores it and resolves its own sweep, as it always has. */
export const NO_SWEEP = 'none'

export function setActiveSweep(id) { activeSweepId = id && id !== 'default' ? id : null }
const sweepHeaders = () => (activeSweepId ? { 'x-sweep-id': activeSweepId } : {})
/** …as a fetch init fragment, so an unpinned call sends no `headers` key at all. */
const sweepInit = () => (activeSweepId ? { headers: sweepHeaders() } : {})

/** EventSource cannot carry a header, so the stream names its sweep in the query. */
export function streamUrl() {
  return activeSweepId ? `/api/stream?sweep=${encodeURIComponent(activeSweepId)}` : '/api/stream'
}

async function get(path) {
  const res = await fetch(path, { credentials: 'include', ...sweepInit() })
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`)
  return res.json()
}

export const fetchBootstrap = () => get('/api/bootstrap')
export const fetchFixtures = () => get('/api/fixtures')
export const fetchStandings = () => get('/api/standings')
export const fetchPhotos = () => get('/api/photos')
export const fetchSyncStatus = () => get('/api/sync-status')

/** Everything the SWEEP shape needs, fetched in parallel. */
export async function fetchAll() {
  const [bootstrap, fixtures, standings, photos, syncStatus] = await Promise.all([
    fetchBootstrap(), fetchFixtures(), fetchStandings(), fetchPhotos(), fetchSyncStatus(),
  ])
  return { bootstrap, fixtures, standings, photos, syncStatus }
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...sweepHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status}`)
  return res.json()
}

export const fetchSocial = () => get('/api/social')
export const postOptout = (personId, duration) => post('/api/optout', { personId, duration })
export const postSupport = (fixtureId, personId, teamCode) => post('/api/support', { fixtureId, personId, teamCode })

export const fetchWallet = (personId) => get(`/api/coins?personId=${encodeURIComponent(personId)}`)
export const fetchLedger = (personId) => get(`/api/coins/ledger?personId=${encodeURIComponent(personId)}`)
export const postBet = ({ fixtureId, personId, market, selection, stake }) => post('/api/bet', { fixtureId, personId, market, selection, stake })
export const postParlay = ({ personId, stake, legs }) => post('/api/parlay', { personId, stake, legs })

// `extra` headers (e.g. adminHeaders() below) are opt-in per call, never ambient:
// only the handful of call sites that need them pass them.
// Each throw carries `.status`: the operator console (screens-super.jsx) tells "sign in"
// (401) apart from "not an operator" (403) by the code, never by reading a role field
// the client can't verify — the server is the only authority on that.
async function getCreds(path, extra) {
  const headers = { ...sweepHeaders(), ...extra }
  const res = await fetch(path, { credentials: 'include', ...(Object.keys(headers).length ? { headers } : {}) })
  if (!res.ok) throw Object.assign(new Error(`GET ${path} failed: HTTP ${res.status}`), { status: res.status })
  return res.json()
}
async function postCreds(path, body, extra) {
  const res = await fetch(path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...sweepHeaders(), ...extra },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw Object.assign(new Error(`POST ${path} failed: HTTP ${res.status}`), { status: res.status })
  return res.json()
}
async function patchCreds(path, body, extra) {
  const res = await fetch(path, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...sweepHeaders(), ...extra },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw Object.assign(new Error(`PATCH ${path} failed: HTTP ${res.status}`), { status: res.status })
  return res.json()
}
async function deleteCreds(path, body, extra) {
  const res = await fetch(path, {
    method: 'DELETE', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...sweepHeaders(), ...extra },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw Object.assign(new Error(`DELETE ${path} failed: HTTP ${res.status}`), { status: res.status })
  return res.json()
}

/** Proof of account auth for the dozen /api/admin/* calls and the operator's
 *  /api/super/* calls — never folded into sweepHeaders(), which rides on every fetch
 *  the SPA makes. That would make a 90-day account credential ambient across the whole
 *  member app: on a shared browser, whoever opens a sweep next would silently inherit
 *  admin over every sweep the account owns. Attached only where the server checks it. */
const adminHeaders = () => {
  const token = getAccountToken()
  return token ? { 'x-account-token': token } : {}
}

export async function uploadPhoto(formData) {
  const res = await fetch('/api/photos', { method: 'POST', credentials: 'include', ...sweepInit(), body: formData })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new Error(`upload failed: ${msg}`)
  }
  return res.json()
}

// Admin here means "the account that owns this sweep" (sweeps/resolve.js derives it
// per request from x-account-token) — there is no separate admin login any more.
export const fetchAdminMe = () => getCreds('/api/admin/me', adminHeaders())
export const fetchAdminPhotos = () => getCreds('/api/admin/photos', adminHeaders())
export const moderatePhoto = (id, action) => postCreds(`/api/admin/photos/${id}`, { action }, adminHeaders())
export const settleStaleBets = () => postCreds('/api/admin/settle-stale', {}, adminHeaders())
export const fetchOpenBets = () => getCreds('/api/admin/open-bets', adminHeaders())

export const postSession = (token) => postCreds('/api/session', { token })
export const fetchWhoami = () => getCreds('/api/whoami')
export const postLogout = () => postCreds('/api/session/logout', {})

export const createPerson = (fields) => postCreds('/api/admin/people', fields, adminHeaders())
export const deletePerson = (id) => deleteCreds(`/api/admin/people/${id}`, {}, adminHeaders())
export const patchPerson = (id, fields) => patchCreds(`/api/admin/people/${id}`, fields, adminHeaders())
export const postOwnership = (personId, teamCode) => postCreds('/api/admin/ownership', { personId, teamCode }, adminHeaders())
export const deleteOwnership = (personId, teamCode) => deleteCreds('/api/admin/ownership', { personId, teamCode }, adminHeaders())
// bulk allocate/unallocate — items: [{ personId, teamCode }]
export const bulkPostOwnership = (items) => postCreds('/api/admin/ownership/bulk', { items }, adminHeaders())
export const bulkDeleteOwnership = (items) => deleteCreds('/api/admin/ownership/bulk', { items }, adminHeaders())

// --- super-admin (platform owner) ---
// An operator is an ordinary account whose role the server checks (requireOperator) —
// there is no separate super token or session to sign in with any more. No create and
// no rotate here: those routes are gone server-side (Task 10) — a member token minted
// by an operator is the ability to walk into any group's sweep, which operating on a
// sweep must never mean.
export const fetchSuperSweeps = () => getCreds('/api/super/sweeps', adminHeaders())
export const archiveSweep = (id) => postCreds(`/api/super/sweeps/${id}/archive`, {}, adminHeaders())
export const unarchiveSweep = (id) => postCreds(`/api/super/sweeps/${id}/unarchive`, {}, adminHeaders())
export const patchSweep = (id, fields) => patchCreds(`/api/super/sweeps/${id}`, fields, adminHeaders())
