import { createApiFootballProvider } from './api-football-provider.js'
import { createApiBasketballProvider } from './api-basketball-provider.js'

const FACTORIES = {
  apifootball: { sport: 'football', create: createApiFootballProvider, window: null }, // Pro key — no season gate
  apibasketball: { sport: 'basketball', create: createApiBasketballProvider, window: { min: 2022, max: 2024 } }, // free tier: seasons by START year 2022–2024 ('2024-2025' verified live 2026-07-04)
}
const cache = new Map()

/** The adapter for a competition's provider (one instance per provider key + api key). */
export function providerFor(competition, { apiKey = process.env.API_FOOTBALL_KEY } = {}) {
  const key = competition.provider
  const entry = FACTORIES[key]
  if (!entry) throw new Error(`unknown provider: ${key}`)
  const cacheKey = `${key} ${apiKey}`
  if (!cache.has(cacheKey)) cache.set(cacheKey, entry.create({ apiKey }))
  return cache.get(cacheKey)
}

export function sportOf(providerKey) {
  const entry = FACTORIES[providerKey]
  if (!entry) throw new Error(`unknown provider: ${providerKey}`)
  return entry.sport
}

export const PROVIDER_KEYS = Object.keys(FACTORIES)

/** Plan gating is invisible in the feed (coverage flags lie) — the window is OUR config. */
export function seasonInWindow(providerKey, season) {
  const entry = FACTORIES[providerKey]
  if (!entry) throw new Error(`unknown provider: ${providerKey}`)
  if (!entry.window) return true
  const y = Number(String(season).slice(0, 4))
  return y >= entry.window.min && y <= entry.window.max
}
