// Pure team-allocation helpers (no React / no SWEEP import) so they're unit-testable
// and reusable by the per-person "allocate N random" UI (and a future draw section).

// Small seedable PRNG for deterministic tests. Returns () => float in [0,1).
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function countFor(ownerCounts, code) {
  if (!ownerCounts) return 0
  if (ownerCounts instanceof Map) return ownerCounts.get(code) || 0
  return ownerCounts[code] || 0
}

// Fisher-Yates shuffle in place using rng.
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Pick up to `count` team codes to allocate to `person`, preferring the
 * least-owned teams (even spread) with a random tie-break, never returning a
 * team the person already owns.
 *
 * @param person       { teams: string[] }
 * @param count        how many to allocate
 * @param teamList     [{ code }] candidate teams
 * @param ownerCounts  Map<code,number> | { [code]: number } current owner counts (missing = 0)
 * @param rng          () => float in [0,1) (inject mulberry32(seed) for tests)
 * @returns string[]   team codes (length = min(count, available))
 */
export function allocateRandomForPerson(person, count, teamList, ownerCounts = {}, rng = Math.random) {
  if (!Number.isFinite(count) || count <= 0) return []
  const owned = new Set(person?.teams || [])
  const candidates = (teamList || []).filter((t) => !owned.has(t.code))
  if (candidates.length === 0) return []
  // bucket by current owner count, shuffle within each bucket, take least-owned first
  const buckets = new Map()
  for (const t of candidates) {
    const c = countFor(ownerCounts, t.code)
    if (!buckets.has(c)) buckets.set(c, [])
    buckets.get(c).push(t.code)
  }
  const order = []
  for (const c of [...buckets.keys()].sort((a, b) => a - b)) {
    order.push(...shuffle(buckets.get(c), rng))
  }
  return order.slice(0, Math.min(count, order.length))
}
