async function get(path) {
  const res = await fetch(path)
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
