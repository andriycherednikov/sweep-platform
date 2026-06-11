// Reconcile our `team` table with the real API-Football World Cup field.
// Pure planning function: given our teams, the provider's teams, and the
// provider-id→group map (from /standings), decide what to update / insert / delete.
// Matched teams KEEP their existing code (so ownership/photos survive); absent teams
// are dropped; real teams we don't have are inserted with a derived code.
import { strengthFor } from '../data/strengths.js'

/** Strip accents, lowercase, collapse non-alphanumerics to single spaces. */
export function normalizeName(s) {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Known spelling variants between our seed names and API-Football names.
const ALIAS = { turkiye: 'turkey' }

/** A canonical match key (applies known aliases). */
export function matchKey(name) {
  const n = normalizeName(name)
  return ALIAS[n] ?? n
}

const NEW_TEAM_DEFAULTS = { color: '#64748b', strength: 70, pool: 'A' }

/** Derive a unique team code for a newly-added real team. */
function deriveCode(realTeam, used) {
  const base = (realTeam.code && /^[A-Za-z]{2,3}$/.test(realTeam.code))
    ? realTeam.code.toLowerCase()
    : normalizeName(realTeam.name).replace(/\s+/g, '-')
  let code = base
  let i = 2
  while (!code || used.has(code)) code = `${base}-${i++}`
  used.add(code)
  return code
}

/**
 * @returns {{updates:Array, inserts:Array, deletes:string[], stats:object}}
 *  updates: { code, name, group, providerTeamId }   (existing teams kept, re-pinned)
 *  inserts: { code, name, group, providerTeamId, color, strength, pool, flagCode }
 *  deletes: team codes present in our table but not in the real field
 */
export function reconcileTeams(ourTeams, realTeams, groupByProvider) {
  const ourByKey = new Map(ourTeams.map((t) => [matchKey(t.name), t]))
  const used = new Set(ourTeams.map((t) => t.code))
  const matchedOurCodes = new Set()
  const updates = []
  const inserts = []

  for (const rt of realTeams) {
    const key = matchKey(rt.name)
    const mine = ourByKey.get(key)
    const group = groupByProvider.get(rt.providerTeamId) ?? mine?.group ?? ''
    if (mine) {
      matchedOurCodes.add(mine.code)
      updates.push({ code: mine.code, name: rt.name, group, providerTeamId: rt.providerTeamId })
    } else {
      const code = deriveCode(rt, used)
      inserts.push({
        code, name: rt.name, group, providerTeamId: rt.providerTeamId,
        flagCode: code, ...NEW_TEAM_DEFAULTS, strength: strengthFor(code, NEW_TEAM_DEFAULTS.strength),
      })
    }
  }

  const deletes = ourTeams.map((t) => t.code).filter((c) => !matchedOurCodes.has(c))
  return {
    updates, inserts, deletes,
    stats: { matched: updates.length, inserted: inserts.length, deleted: deletes.length },
  }
}
