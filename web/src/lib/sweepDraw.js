// Plan a whole-sweep "top up to N" draw: for each person, allocate enough teams
// to reach `teamsPerPerson`, spreading evenly across all teams (least-owned first)
// by carrying a running owner-count map through the batch. Pure + seedable so the
// admin Sweep tab can preview, re-roll, and animate without touching the server.
import { allocateRandomForPerson, mulberry32 } from './allocate.js'

// Fisher-Yates shuffle in place using rng (so person order isn't positionally
// biased toward the scarce teams once co-ownership kicks in).
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * @param people          [{ id, teams: string[] }]
 * @param teamList         [{ code }]
 * @param teamsPerPerson   target team count per person (top-up: existing teams kept)
 * @param seed             integer seed for deterministic / re-rollable draws
 * @returns {{
 *   added: {personId,teamCode}[],          // every new allocation, in reveal order
 *   byPerson: {[id]: string[]},            // newly added codes for EVERY person ([] if none)
 *   reveal: {personId,codes}[],            // draw-order, only people receiving teams
 *   seed: number
 * }}
 */
export function planSweep(people, teamList, { teamsPerPerson, seed }) {
  const rng = mulberry32((seed | 0) >>> 0)
  const list = teamList || []

  // running owner counts, seeded from current ownership so the top-up stays balanced
  const counts = {}
  for (const t of list) counts[t.code] = 0
  for (const p of people || []) for (const c of p.teams || []) counts[c] = (counts[c] || 0) + 1

  const order = shuffle((people || []).slice(), rng)

  const byPerson = {}
  const added = []
  const reveal = []
  for (const p of order) {
    const need = Math.max(0, (teamsPerPerson || 0) - (p.teams?.length || 0))
    const codes = need > 0 ? allocateRandomForPerson(p, need, list, counts, rng) : []
    byPerson[p.id] = codes
    if (codes.length) {
      reveal.push({ personId: p.id, codes })
      for (const c of codes) {
        counts[c] = (counts[c] || 0) + 1
        added.push({ personId: p.id, teamCode: c })
      }
    }
  }
  // ensure every person has an entry, even those skipped above
  for (const p of people || []) if (!(p.id in byPerson)) byPerson[p.id] = []

  return { added, byPerson, reveal, seed }
}
