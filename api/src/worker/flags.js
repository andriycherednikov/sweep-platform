/**
 * @param {{id:string,t1Code:string,t2Code:string}[]} fixtures
 * @param {{personId:string,teamCode:string}[]} ownershipRows
 * @returns {Map<string,{derby:boolean,doubleOwner:boolean}>}
 */
export function computeFlags(fixtures, ownershipRows) {
  const ownersByTeam = new Map()
  for (const o of ownershipRows) {
    if (!ownersByTeam.has(o.teamCode)) ownersByTeam.set(o.teamCode, new Set())
    ownersByTeam.get(o.teamCode).add(o.personId)
  }
  const out = new Map()
  for (const f of fixtures) {
    const o1 = ownersByTeam.get(f.t1Code) ?? new Set()
    const o2 = ownersByTeam.get(f.t2Code) ?? new Set()
    const derby = o1.size > 0 && o2.size > 0
    const doubleOwner = [...o1].some((p) => o2.has(p))
    out.set(f.id, { derby, doubleOwner })
  }
  return out
}
