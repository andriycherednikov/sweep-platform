// Canonical team power ratings (0–100), keyed by team code.
// Anchored to the FIFA ranking (elite order users recognise) + a 48-team
// WC-2026 power ranking. Single source of truth: the seed generator AND the
// team-reconciler both read from here, so a fresh seed and any later provider
// re-sync land on the same ratings instead of a flat default.
export const STRENGTH_BY_CODE = {
  // elite
  ar: 90, es: 89, fr: 89, 'gb-eng': 88, pt: 87, br: 87,
  nl: 84, de: 84, hr: 82, be: 81, co: 80,
  // strong
  ma: 78, uy: 78, us: 77, mx: 76, jp: 75, no: 74, ch: 74, sn: 74, ec: 73, kr: 73, tr: 72,
  at: 72, se: 71, ca: 70, py: 68, sco: 68, cze: 67, ci: 67, gh: 66, ir: 66,
  // mid
  eg: 65, dz: 64, au: 64, sa: 63, bih: 63, tn: 62, jor: 61, cgo: 61, uzb: 60, qa: 59, irq: 59,
  // outsiders
  za: 58, cpv: 57, nz: 57, pan: 56, cur: 55, hai: 54,
}

/** Lookup with a sensible fallback for any team we haven't rated yet. */
export function strengthFor(code, fallback = 70) {
  return STRENGTH_BY_CODE[code] ?? fallback
}
