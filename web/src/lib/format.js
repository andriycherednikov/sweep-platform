// Our team codes aren't all ISO 3166-1 alpha-2; map the odd ones to flagcdn codes.
const FLAG_FIX = {
  bih: 'ba', cgo: 'cd', cpv: 'cv', cur: 'cw', cze: 'cz',
  hai: 'ht', irq: 'iq', jor: 'jo', pan: 'pa', sco: 'gb-sct', uzb: 'uz',
}

export function flag(code, size) {
  size = size || 80
  const c = FLAG_FIX[code] || code
  if (c.indexOf('gb-') === 0) return 'https://flagcdn.com/' + c + '.svg'
  return 'https://flagcdn.com/w' + size + '/' + c + '.png'
}

export function gd(t) { return t.gf - t.ga }

// All formatters use the runtime's LOCAL timezone (no timeZone option).
export function fmtTime(d) {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toUpperCase().replace(/\s/, ' ')
}
// "Sat, 13 June" — weekday short · day · full month.
// en-IE produces the required "Weekday, D Month" order with comma on this Node.
export function fmtDate(d) {
  return new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'long' }).format(d)
}
// "Sat, 13 June · 4:30 PM" — the one canonical date+time string.
export function fmtDateTime(d) {
  return fmtDate(d) + ' · ' + fmtTime(d)
}
export function fmtDayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function fmtWeekday(d) {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(d)
}

// One-line fixture label: canonical date+time plus a status suffix.
// Prefers the precomputed f.dateTimeLabel, falling back to f.ko.
export function whenLabel(f) {
  const base = f.dateTimeLabel || fmtDateTime(f.ko)
  if (f.status === 'live') return `${base} · ${f.minute}'`
  if (f.status === 'final') return `${base} · FT`
  return base
}
