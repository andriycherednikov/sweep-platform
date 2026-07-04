/** Per-sport config. hasDraws drives 3-way vs 2-way results ('DRAW' sentinel legal or not). */
export const SPORTS = {
  football: { hasDraws: true, gradeOn: 'regulation' },   // bets grade on the 90' score (unchanged behavior)
  basketball: { hasDraws: false, gradeOn: 'final' },     // final score incl. OT
}

export function sportConfig(sport) {
  const c = SPORTS[sport]
  if (!c) throw new Error(`unknown sport: ${sport}`)
  return c
}
