// Parse a /super route into an optional auto-submit super token.
// Mirrors App.readView: split on "/", drop empty segments.
//   /super            -> { token: null }
//   /super/<token>    -> { token: '<token>' }
// Any non-/super path -> { token: null }
export function parseSuperRoute(path) {
  const seg = path.split('/').filter(Boolean)
  if (seg[0] !== 'super') return { token: null }
  return { token: seg[1] || null }
}
