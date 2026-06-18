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

export const fetchWallet = (personId) => get(`/api/coins?personId=${encodeURIComponent(personId)}`)
export const fetchLedger = (personId) => get(`/api/coins/ledger?personId=${encodeURIComponent(personId)}`)
export const postBet = ({ fixtureId, personId, market, selection, stake }) => post('/api/bet', { fixtureId, personId, market, selection, stake })

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
async function patchCreds(path, body) {
  const res = await fetch(path, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} failed: HTTP ${res.status}`)
  return res.json()
}
async function deleteCreds(path, body) {
  const res = await fetch(path, {
    method: 'DELETE', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`DELETE ${path} failed: HTTP ${res.status}`)
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

export const postSession = (token) => postCreds('/api/session', { token })
export const fetchWhoami = () => getCreds('/api/whoami')
export const postLogout = () => postCreds('/api/session/logout', {})

export const createPerson = (fields) => postCreds('/api/admin/people', fields)
export const deletePerson = (id) => deleteCreds(`/api/admin/people/${id}`, {})
export const patchPerson = (id, fields) => patchCreds(`/api/admin/people/${id}`, fields)
export const postOwnership = (personId, teamCode) => postCreds('/api/admin/ownership', { personId, teamCode })
export const deleteOwnership = (personId, teamCode) => deleteCreds('/api/admin/ownership', { personId, teamCode })
// bulk allocate/unallocate — items: [{ personId, teamCode }]
export const bulkPostOwnership = (items) => postCreds('/api/admin/ownership/bulk', { items })
export const bulkDeleteOwnership = (items) => deleteCreds('/api/admin/ownership/bulk', { items })

// --- super-admin (platform owner) ---
// patchCreds(path, body) is defined above (Slice 3); imported/used here, never redefined.
export const postSuperSession = (token) => postCreds('/api/super/session', { token })
export const fetchSuperSweeps = () => getCreds('/api/super/sweeps')
export const createSweep = (name) => postCreds('/api/super/sweeps', { name })
export const rotateSweepToken = (id, which) => postCreds(`/api/super/sweeps/${id}/rotate`, { which })
export const archiveSweep = (id) => postCreds(`/api/super/sweeps/${id}/archive`, {})
export const unarchiveSweep = (id) => postCreds(`/api/super/sweeps/${id}/unarchive`, {})
export const patchSweep = (id, fields) => patchCreds(`/api/super/sweeps/${id}`, fields)
