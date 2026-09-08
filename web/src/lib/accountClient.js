const KEY = 'sweep.account.token.v1'
export const getAccountToken = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const setAccountToken = (t) => { try { localStorage.setItem(KEY, t) } catch {} }
export const clearAccountToken = () => { try { localStorage.removeItem(KEY) } catch {} }

async function call(method, path, body) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const tok = getAccountToken()
  if (tok) headers['x-account-token'] = tok
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, code: data?.error, body: data })
  return data
}
export const requestLogin = (email) => call('POST', '/api/account/login', { email })
export async function redeemLogin(token) {
  const out = await call('POST', '/api/account/session', { token })
  setAccountToken(out.accountToken)
  return out.account
}
export async function passwordLogin(email, password) {
  const out = await call('POST', '/api/account/password/session', { email, password })
  setAccountToken(out.accountToken)
  return out.account
}
// `current` is omitted (not sent as undefined) when unset: a fresh magic-link session
// may set a first password without it, and the API tells current-required apart from
// bad-credentials, so an absent field must mean "none supplied", not "supplied as empty".
export const setPassword = (password, current) => call('POST', '/api/account/password', current ? { password, current } : { password })
export const getAccount = () => call('GET', '/api/account')
export const getCatalog = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return call('GET', `/api/catalog${qs ? `?${qs}` : ''}`)
}
export const getAccountSweeps = () => call('GET', '/api/account/sweeps')
export const createSweep = (body) => call('POST', '/api/account/sweeps', body)
export const archiveSweep = (id) => call('POST', `/api/account/sweeps/${id}/archive`)
// Replaces the member token, which is the ONLY credential POST /api/session accepts:
// the leaked link dies, and so does everyone else's. Returns the fresh { memberLink }.
export const rotateSweep = (id) => call('POST', `/api/account/sweeps/${id}/rotate`)
export const getBilling = () => call('GET', '/api/account/billing')
export const confirmCheckout = (sessionId) => call('POST', '/api/account/billing/confirm', { sessionId })
export const startCheckout = () => call('POST', '/api/account/billing/checkout')
export const openPortal = (flow) => call('POST', '/api/account/billing/portal', flow ? { flow } : undefined)

// Revokes the 90-day session server-side — before Task 7 there was no way to do this
// at all, and the token now confers admin over every sweep the account owns.
export const revokeSession = () => call('DELETE', '/api/account/session')
export const revokeAllSessions = () => call('DELETE', '/api/account/sessions')
