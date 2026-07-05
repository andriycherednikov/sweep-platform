const KEY = 'sweep.account.token.v1'
export const getAccountToken = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const setAccountToken = (t) => { try { localStorage.setItem(KEY, t) } catch {} }
export const clearAccountToken = () => { try { localStorage.removeItem(KEY) } catch {} }

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json' }
  const tok = getAccountToken()
  if (tok) headers['x-account-token'] = tok
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, code: data?.error })
  return data
}
export const requestLogin = (email) => call('POST', '/api/account/login', { email })
export async function redeemLogin(token) {
  const out = await call('POST', '/api/account/session', { token })
  setAccountToken(out.accountToken)
  return out.account
}
export const getAccount = () => call('GET', '/api/account')
export const getAccountSweeps = () => call('GET', '/api/account/sweeps')
export const archiveSweep = (id) => call('POST', `/api/account/sweeps/${id}/archive`)
export const getBilling = () => call('GET', '/api/account/billing')
export const startCheckout = () => call('POST', '/api/account/billing/checkout')
export const openPortal = () => call('POST', '/api/account/billing/portal')
