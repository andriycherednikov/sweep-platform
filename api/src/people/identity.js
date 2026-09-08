// Avatar colours for people the app creates. Ported from web/src/screens-detail.jsx:1164
// so the two paths agree on the palette.
const AV_PALETTE = ['#c9472f', '#3b6fd1', '#1f9d57', '#b8860b', '#7b4bd1', '#0a9396', '#bb3e03', '#6a4c93']

/** short/initials/colour derived from a name. A member-facing route must not take
 *  cosmetic fields on trust, and deriving them keeps them from drifting on a rename.
 *  `short` is the first word - it is what the sidebar chip and the pick lists show. */
export function identityFor(name) {
  const trimmed = name.trim()
  return {
    short: trimmed.split(/\s+/)[0],
    initials: trimmed.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '??',
    avColor: AV_PALETTE[Math.abs([...trimmed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % AV_PALETTE.length],
  }
}
