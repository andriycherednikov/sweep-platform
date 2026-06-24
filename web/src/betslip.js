import { useState, useEffect } from 'react'

const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

let legs = [] // [{ fixtureId, market, selection, odds, line, book, label }]

export function betslipLegs() { return legs }
export function betslipCount() { return legs.length }
export function combinedOdds() { return legs.reduce((acc, l) => acc * l.odds, 1) }
export function hasLeg(fixtureId, market, selection) {
  return legs.some((l) => l.fixtureId === fixtureId && l.market === market && l.selection === selection)
}
export function removeLeg(fixtureId, market, selection) {
  legs = legs.filter((l) => !(l.fixtureId === fixtureId && l.market === market && l.selection === selection))
  notify()
}
export function clearBetslip() { legs = []; notify() }

/** Toggle a selection in the slip. Re-tapping the same selection removes it; any other
 *  market/selection adds a new leg — including another market on a fixture already in the
 *  slip (a same-game multi). The server still rejects two selections of the SAME market. */
export function toggleLeg(leg) {
  if (hasLeg(leg.fixtureId, leg.market, leg.selection)) {
    legs = legs.filter((l) => !(l.fixtureId === leg.fixtureId && l.market === leg.market && l.selection === leg.selection))
  } else {
    legs = [...legs, leg]
  }
  notify()
}

export function useBetslip() {
  const [, force] = useState(0)
  useEffect(() => { const fn = () => force((x) => x + 1); listeners.add(fn); return () => listeners.delete(fn) }, [])
  return { legs }
}
