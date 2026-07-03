import { createApiFootballProvider } from './api-football-provider.js'
import { createApiBasketballProvider } from './api-basketball-provider.js'

const FACTORIES = {
  apifootball: { sport: 'football', create: createApiFootballProvider },
  apibasketball: { sport: 'basketball', create: createApiBasketballProvider },
}
const cache = new Map()

/** The adapter for a competition's provider (one instance per provider key). */
export function providerFor(competition, { apiKey = process.env.API_FOOTBALL_KEY } = {}) {
  const key = competition.provider
  const entry = FACTORIES[key]
  if (!entry) throw new Error(`unknown provider: ${key}`)
  if (!cache.has(key)) cache.set(key, entry.create({ apiKey }))
  return cache.get(key)
}

export function sportOf(providerKey) {
  const entry = FACTORIES[providerKey]
  if (!entry) throw new Error(`unknown provider: ${providerKey}`)
  return entry.sport
}
