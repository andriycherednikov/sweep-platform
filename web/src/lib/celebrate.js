import confetti from 'canvas-confetti'

export function reducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Celebratory burst for a crowned winner: two angled volleys from the bottom
// corners toward the centre. No-op under prefers-reduced-motion; wrapped so a
// canvas-less environment (jsdom, SSR) can never throw.
export function celebrate() {
  if (reducedMotion()) return
  try {
    const base = { particleCount: 90, spread: 70, startVelocity: 45, ticks: 220, zIndex: 3000 }
    confetti({ ...base, angle: 60, origin: { x: 0, y: 0.9 } })
    confetti({ ...base, angle: 120, origin: { x: 1, y: 0.9 } })
  } catch { /* no canvas available — skip the flourish */ }
}
