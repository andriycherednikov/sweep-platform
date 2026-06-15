async function get(path) {
  const res = await fetch(path, { credentials: 'include' })
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status}`)
  return res.json()
}

export const fetchSocial = () => get('/api/social')
export const postWatch = (fixtureId, personId) => post('/api/watch', { fixtureId, personId })
export const postSupport = (fixtureId, personId, teamCode) => post('/api/support', { fixtureId, personId, teamCode })

async function getCreds(path) {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`)
  return res.json()
}
async function postCreds(path, body) {
  const res = await fetch(path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status}`)
  return res.json()
}

export async function uploadPhoto(formData) {
  const res = await fetch('/api/photos', { method: 'POST', credentials: 'include', body: formData })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new Error(`upload failed: ${msg}`)
  }
  return res.json()
}

export const adminLogin = (passcode) => postCreds('/api/admin/login', { passcode })
export const adminLogout = () => postCreds('/api/admin/logout', {})
export const fetchAdminMe = () => getCreds('/api/admin/me')
export const fetchAdminPhotos = () => getCreds('/api/admin/photos')
export const moderatePhoto = (id, action) => postCreds(`/api/admin/photos/${id}`, { action })
