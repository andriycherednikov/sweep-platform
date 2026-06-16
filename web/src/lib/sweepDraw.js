// Plan a whole-sweep "top up to N" draw that is both fair and random:
//  - every person is topped up to `teamsPerPerson` (existing teams kept),
//  - teams are reused evenly (least-owned first, so all teams are used before
//    any is doubled), and
//  - total team STRENGTH is balanced across people, so no one hoards the giants
//    while someone else gets only minnows.
// Pure + seedable so the admin Sweep tab can preview, re-roll and animate it.
import { mulberry32 } from './allocate.js'

// Fisher-Yates shuffle in place using rng.
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// The neediest-by-power person picks randomly among the K strongest available
// teams. K=1 is perfectly balanced but identical every re-roll; K=2 keeps the
// balance tight while giving each re-roll a genuinely different (still fair) draw.
const TOP_K = 2

/**
 * @param people          [{ id, teams: string[] }]
 * @param teamList         [{ code, strength }]
 * @param teamsPerPerson   target team count per person (top-up: existing teams kept)
 * @param seed             integer seed for deterministic / re-rollable draws
 * @returns {{
 *   added: {personId,teamCode}[],   // every new allocation, in reveal order (interleaved across people)
 *   byPerson: {[id]: string[]},     // newly added codes for EVERY person ([] if none)
 *   reveal: {personId,codes}[],     // draw-order, only people receiving teams
 *   seed: number
 * }}
 */
export function planSweep(people, teamList, { teamsPerPerson, seed }) {
  const rng = mulberry32((seed | 0) >>> 0)
  const list = teamList || []
  const strengthOf = {}
  for (const t of list) strengthOf[t.code] = t.strength || 0

  // running owner counts, seeded from current ownership (keeps team reuse even)
  const counts = {}
  for (const t of list) counts[t.code] = 0
  for (const p of people || []) for (const c of p.teams || []) counts[c] = (counts[c] || 0) + 1

  const state = (people || []).map((p) => {
    const owned = new Set(p.teams || [])
    let total = 0
    for (const c of owned) total += strengthOf[c] || 0
    return { id: p.id, owned, total, need: Math.max(0, (teamsPerPerson || 0) - owned.size), added: [] }
  })

  const added = []
  while (true) {
    const needing = state.filter((p) => p.need > 0)
    if (!needing.length) break
    // pick the lowest-power person who still needs a team (random tie-break)
    const cands = shuffle(needing, rng)
    let person = cands[0]
    for (const c of cands) if (c.total < person.total) person = c

    // teams this person can still take, restricted to the least-owned bucket (even reuse)
    const avail = list.filter((t) => !person.owned.has(t.code))
    if (!avail.length) { person.need = 0; continue }
    let minCount = Infinity
    for (const t of avail) { const c = counts[t.code] || 0; if (c < minCount) minCount = c }
    const bucket = avail.filter((t) => (counts[t.code] || 0) === minCount)
    bucket.sort((a, b) => (strengthOf[b.code] || 0) - (strengthOf[a.code] || 0))

    // Steer toward balance: a person below the mean power takes a strong team to
    // catch up; one already at/above the mean (e.g. they pre-own the giants) takes
    // a weak one. Random within the top/bottom-K keeps each re-roll different.
    const mean = state.reduce((s, p) => s + p.total, 0) / state.length
    const k = Math.min(TOP_K, bucket.length)
    const pick = person.total <= mean
      ? bucket[Math.floor(rng() * k)]
      : bucket[bucket.length - 1 - Math.floor(rng() * k)]

    person.owned.add(pick.code)
    person.total += strengthOf[pick.code] || 0
    person.added.push(pick.code)
    counts[pick.code] = (counts[pick.code] || 0) + 1
    person.need -= 1
    added.push({ personId: person.id, teamCode: pick.code })
  }

  const byPerson = {}
  for (const p of state) byPerson[p.id] = p.added
  for (const p of people || []) if (!(p.id in byPerson)) byPerson[p.id] = []

  const reveal = []
  const seen = new Set()
  for (const row of added) {
    if (!seen.has(row.personId)) { seen.add(row.personId); reveal.push({ personId: row.personId, codes: byPerson[row.personId] }) }
  }

  return { added, byPerson, reveal, seed }
}
