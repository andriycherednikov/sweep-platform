import { sportConfig } from '../sports.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * API-Sports reports refusals in-band, not by status code: a blocked season, an
 * exhausted quota or a bad key all arrive as HTTP 200 with `errors` populated and
 * `response` empty. `errors` is [] when healthy and an object of reason strings
 * when not. Returns a one-line summary, or null when the body is clean.
 */
function errorsIn(j) {
  const e = j?.errors
  if (e == null) return null
  const parts = Array.isArray(e) ? e.map(String) : Object.entries(e).map(([k, v]) => `${k}: ${v}`)
  return parts.length ? parts.join('; ') : null
}

/** Shared HTTP client for the API-Sports family (football/basketball/... are shape-identical). */
export function createApiSportsClient({ base, apiKey, fetch = globalThis.fetch, retries = 3, retryDelayMs = 500 }) {
  async function get(path, params = {}) {
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    let lastErr
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url.toString(), { headers: { 'x-apisports-key': apiKey } })
        if (res.ok) {
          const j = await res.json()
          const refused = errorsIn(j)
          if (!refused) return j
          lastErr = new Error(`api-sports ${path} → ${refused}`)
          break // a plan, a quota or a bad key: backoff cannot fix it, and each retry spends another request
        }
        lastErr = new Error(`api-sports ${path} → HTTP ${res.status}`)
        if (res.status < 500 && res.status !== 429) break // client errors don't retry (except rate-limit)
      } catch (e) { lastErr = e }
      if (attempt < retries - 1) await sleep(retryDelayMs * 2 ** attempt)
    }
    throw lastErr ?? new Error(`api-sports ${path} failed`)
  }
  return { get }
}

/** Mapped winnerSide → settlement result, guarding the 'DRAW' sentinel per sport. */
export function winnerSideToResult(side, sport) {
  if (side == null) return null
  if (side === 'draw' && !sportConfig(sport).hasDraws) {
    throw new Error(`no-draw sport ${sport} produced a drawn final`)
  }
  const result = { home: 'HOME', away: 'AWAY', draw: 'DRAW' }[side]
  if (!result) throw new Error(`unknown winner side: ${side}`) // mapper bug — never grade on garbage
  return result
}
