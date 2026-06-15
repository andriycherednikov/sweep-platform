// Parse a /super route into a flag + optional auto-submit super token.
// Mirrors App.readView: split on "/", drop empty segments.
//   /super            -> { isSuper: true,  token: null }
//   /super/<token>    -> { isSuper: true,  token: '<token>' }
// Any non-/super path -> { isSuper: false, token: null }
// `isSuper` lets the entry point (main.jsx) mount the super console standalone,
// outside the sweep Gate — the platform owner has a super cookie, not a sweep
// session, so the Gate's bootstrap would otherwise 401 and block /super.
export function parseSuperRoute(path) {
  const seg = path.split('/').filter(Boolean)
  if (seg[0] !== 'super') return { isSuper: false, token: null }
  return { isSuper: true, token: seg[1] || null }
}
